import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { connect as netConnect } from 'node:net'
import { promises as dns } from 'node:dns'
import { extname, join } from 'node:path'

/**
 * GitHub publishing helpers: is the network actually usable, and can a commit
 * leave this machine.\
 *
 * The settings page used to stop at "gh is installed and signed in". In
 * practice the failures that cost hours are one layer below that: a stale
 * `http.proxy` pointing at a port nobody listens on, GitHub's name resolving to
 * an address that is not GitHub, or a `git push` that hangs forever instead of
 * failing. This module answers those questions with data and gives every git
 * call a deadline.
 *
 * Nothing here stores credentials: `gh` keeps its own and git keeps its own.
 */

const PROBE_TIMEOUT_MS = 4000
const GIT_TIMEOUT_MS = 20_000
const PUSH_TIMEOUT_MS = 60_000
const CREATE_TIMEOUT_MS = 120_000
const VIEW_TIMEOUT_MS = 30_000

/**
 * GitHub's published ranges. The list is a hint, not a rule: GitHub rotates
 * addresses, so an address outside it is reported but never treated as fatal.
 */
const GITHUB_PREFIXES = [
  '140.82.',
  '143.55.',
  '192.30.',
  '20.205.',
  '20.27.',
  '20.233.',
  '20.248.',
  '4.237.',
  '4.208.',
]

const REG_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

/**
 * Run a command with a hard deadline. On timeout the whole process tree is
 * killed: a hung `git push` spawns helpers, and killing only the parent leaves
 * the network connection (and the panel) waiting.
 */
export function runProcess(command, args, { cwd, env = process.env, timeoutMs = GIT_TIMEOUT_MS, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: platform !== 'win32',
      })
    } catch (error) {
      resolve({ code: 127, stdout: '', stderr: error && error.message ? error.message : String(error), timedOut: false, killed: false })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let killed = false
    let timer = null
    const finish = (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr, timedOut, killed })
    }
    const killTree = () => {
      killed = true
      try {
        if (platform === 'win32') {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        } else {
          process.kill(-child.pid, 'SIGKILL')
        }
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // The child already exited; there is nothing left to kill.
        }
      }
    }
    timer = setTimeout(() => {
      timedOut = true
      killTree()
      finish(124)
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      stderr = `${stderr}\n${error.message}`.trim()
      finish(127)
    })
    child.on('close', (code) => finish(code ?? 1))
  })
}

/** Empty input and obvious non-proxies become `null`. */
export function normalizeProxyUrl(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null
  if (/^(direct|none|off)$/i.test(text)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
  let url
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  return { url: url.origin, host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) }
}

/**
 * The Windows proxy value is either `host:port` or a per-protocol list such as
 * `http=host:port;https=host:port`. Both forms become the https entry.
 */
export function parseProxyServer(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null
  const parts = text.split(';')
  const named = parts.find((part) => /^https=/i.test(part))
  if (named) return normalizeProxyUrl(named.replace(/^https=/i, ''))
  const plain = parts.find((part) => part && !part.includes('='))
  return normalizeProxyUrl(plain || '')
}

/** `ProxyEnable` + `ProxyServer` from the current user's Internet Settings. */
export function parseRegistryProxy(stdout) {
  const text = String(stdout || '')
  const enabled = /ProxyEnable\s+REG_DWORD\s+(0x[0-9a-f]+|\d+)/i.exec(text)
  const server = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(text)
  const isOn = enabled ? Number(enabled[1]) === 1 : false
  return {
    enabled: isOn,
    server: server ? server[1] : null,
    proxy: isOn && server ? parseProxyServer(server[1]) : null,
  }
}

/** System proxy: the Windows registry first, `HTTPS_PROXY` elsewhere. */
export async function readSystemProxy({ platform = process.platform, env = process.env, run = runProcess } = {}) {
  if (platform === 'win32') {
    const query = await run('reg', ['query', REG_PATH], { timeoutMs: 8000, platform })
    const parsed = parseRegistryProxy(query.stdout)
    if (parsed.enabled && parsed.proxy) return { source: 'system', enabled: true, server: parsed.server, proxy: parsed.proxy }
    const fallback = normalizeProxyUrl(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy)
    return { source: 'system', enabled: parsed.enabled, server: parsed.server, proxy: parsed.enabled ? null : fallback }
  }
  const value = normalizeProxyUrl(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy)
  return { source: 'env', enabled: Boolean(value), server: value ? value.url : null, proxy: value }
}

/** The proxy git itself would use in `cwd` (`http.proxy` covers https remotes). */
export async function readGitProxy(cwd, { run = runProcess, timeoutMs = 8000 } = {}) {
  if (!cwd) return { configured: false, proxy: null, raw: null }
  const result = await run('git', ['config', '--get', 'http.proxy'], { cwd, timeoutMs })
  const raw = result.code === 0 ? result.stdout.trim() : ''
  return { configured: Boolean(raw), proxy: normalizeProxyUrl(raw), raw: raw || null }
}

/**
 * DNS + TCP reality check for one host. A name that resolves to an address
 * outside GitHub's ranges still connects (CDN, mirror, proxy); it is only a
 * signal worth showing next to the verdict.
 */export async function probeHost(host, port = 443, {
  timeoutMs = PROBE_TIMEOUT_MS,
  lookup = (name) => dns.lookup(name, { all: true, verbatim: true }),
  connect = netConnect,
} = {}) {
  let addresses = []
  let dnsError = null
  try {
    const found = await lookup(host)
    addresses = (Array.isArray(found) ? found : [found])
      .map((entry) => (typeof entry === 'string' ? entry : entry && entry.address))
      .filter(Boolean)
  } catch (error) {
    dnsError = error && error.code ? String(error.code) : (error && error.message ? error.message : String(error))
  }
  const tcp = await new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    let socket
    const done = (ok, error) => {
      if (settled) return
      settled = true
      try {
        if (socket) socket.destroy()
      } catch {
        // A destroyed socket needs no cleanup.
      }
      resolve({ ok, ms: Date.now() - started, error: error || null })
    }
    try {
      socket = connect({ host, port })
    } catch (error) {
      done(false, error && error.code ? String(error.code) : 'connect failed')
      return
    }
    socket.setTimeout(timeoutMs, () => done(false, 'timeout'))
    socket.once('connect', () => done(true, null))
    socket.once('error', (error) => done(false, error && error.code ? String(error.code) : String(error)))
  })
  return {
    host,
    port,
    resolved: addresses,
    knownGithub: addresses.length > 0 && addresses.every((ip) => GITHUB_PREFIXES.some((prefix) => String(ip).startsWith(prefix))),
    dnsError,
    tcp,
  }
}

/**
 * An HTTPS HEAD is the only honest "GitHub is reachable" signal: a poisoned
 * name can still accept a TCP connection, so a TLS/HTTP failure is what
 * distinguishes a real path from a look-alike.
 */
export async function probeHttps(url = 'https://github.com/', { timeoutMs = PROBE_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  if (typeof timer.unref === 'function') timer.unref()
  try {
    const response = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal: controller.signal })
    return { ok: true, status: response.status, ms: Date.now() - started, error: null }
  } catch (error) {
    return { ok: false, status: null, ms: Date.now() - started, error: (error && (error.code || error.name)) || String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/** Which proxy wins: the explicit setting, then git's own, then the system's. */
export async function detectProxy({ cwd, override = '', platform = process.platform, env = process.env, run = runProcess } = {}) {
  const explicit = normalizeProxyUrl(override)
  if (explicit) return { proxy: explicit, source: 'override', system: null, git: null }
  const git = await readGitProxy(cwd, { run })
  if (git.proxy) return { proxy: git.proxy, source: 'git', system: null, git }
  const system = await readSystemProxy({ platform, env, run })
  return { proxy: system.proxy, source: system.proxy ? 'system' : null, system, git }
}

/** What the network layer says about getting to GitHub from this machine. */
export async function networkReport({
  cwd,
  override = '',
  host = 'github.com',
  port = 443,
  platform = process.platform,
  env = process.env,
  run = runProcess,
  lookup,
  connect,
  fetchImpl = fetch,
  timeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  const detected = await detectProxy({ cwd, override, platform, env, run })
  const chosen = detected.proxy
  const direct = await probeHost(host, port, { timeoutMs, lookup, connect })
  const https = await probeHttps(`https://${host}/`, { timeoutMs, fetchImpl })
  const viaProxy = chosen ? await probeHost(chosen.host, chosen.port, { timeoutMs, lookup, connect }) : null
  const verdict = (() => {
    if (https.ok) return 'direct'
    if (chosen) return viaProxy && viaProxy.tcp.ok ? 'proxy' : 'proxy-dead'
    return 'blocked'
  })()
  return {
    host,
    port,
    verdict,
    dns: { resolved: direct.resolved, knownGithub: direct.knownGithub, error: direct.dnsError },
    direct: direct.tcp,
    https,
    proxy: chosen
      ? { url: chosen.url, host: chosen.host, port: chosen.port, reachable: Boolean(viaProxy && viaProxy.tcp.ok), ms: viaProxy ? viaProxy.tcp.ms : null, error: viaProxy ? viaProxy.tcp.error : null, source: detected.source }
      : null,
    system: detected.system ? { enabled: detected.system.enabled, server: detected.system.server } : { enabled: false, server: null },
    git: detected.git ? { configured: detected.git.configured, raw: detected.git.raw } : { configured: false, raw: null },
    checkedAt: new Date().toISOString(),
  }
}

/** `git ls-remote` output → the commit for one branch, or null. */
export function parseLsRemote(text, branch) {
  const wanted = `refs/heads/${branch}`
  for (const line of String(text || '').split(/\r?\n/)) {
    const [sha, ref] = line.trim().split(/\s+/)
    if (ref === wanted && /^[0-9a-f]{40}$/i.test(sha)) return sha
  }
  return null
}

/** `git log --oneline` output → `{hash, subject}` rows. */
export function parsePendingLog(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([0-9a-f]{4,40})\s+(.*)$/i.exec(line)
      return match ? { hash: match[1], subject: match[2] } : null
    })
    .filter(Boolean)
}

/**
 * Turn git's stderr into one cause. `git push` reports a stale proxy as a plain
 * connect failure, so the network family is deliberately broad.
 */
export function classifyGitFailure(text) {
  const value = String(text || '')
  if (/timed out after \d+ ms/i.test(value)) return 'timeout'
  if (/Could not resolve host|getaddrinfo|Name or service not known/i.test(value)) return 'dns'
  if (/Proxy CONNECT aborted|proxy|Connection refused|Failed to connect|Could not connect|Connection was reset|Connection reset by peer|ECONNRESET|ETIMEDOUT|Operation timed out|empty reply/i.test(value)) return 'network'
  if (/Authentication failed|Permission denied|Permission to .* denied|403|401|invalid username or password|could not read Username|terminal prompts disabled|Support for password authentication was removed/i.test(value)) return 'auth'
  if (/non-fast-forward|fetch first|rejected/i.test(value)) return 'non-fast-forward'
  if (/does not appear to be a git repository|Repository not found|not found/i.test(value)) return 'missing-repo'
  return 'unknown'
}

function gitArgs(proxy, args) {
  return proxy && proxy.url ? ['-c', `http.proxy=${proxy.url}`, ...args] : [...args]
}

function out(result) {
  return result ? String(result.stdout || '').trim() : ''
}

/** One `git` call with the proxy pin and a deadline. */
export async function git(cwd, args, { proxy, timeoutMs = GIT_TIMEOUT_MS, run = runProcess, env = process.env } = {}) {
  return run('git', gitArgs(proxy, args), {
    cwd,
    timeoutMs,
    env: { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  })
}

/**
 * Everything the panel shows about one repository: where HEAD is, where the
 * remote branch is, what is still pending, and whether the worktree is dirty.
 * Remote lookups are best effort: a failed `ls-remote` never fails the snapshot.
 */
export async function repoSnapshot({ cwd, remote = 'origin', branch = '', proxy = null, timeoutMs = GIT_TIMEOUT_MS, run = runProcess } = {}) {
  const base = { cwd: cwd || '', remote, branch: branch || '', checkedAt: new Date().toISOString() }
  if (!cwd) return { ok: false, isRepo: false, error: 'no-repository-configured', ...base }
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return { ok: false, isRepo: false, error: 'repository-path-missing', ...base }
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'], { run, timeoutMs })
  if (inside.code !== 0) return { ok: false, isRepo: false, error: 'not-a-git-repository', detail: out(inside.stderr), ...base }
  const root = out(await git(cwd, ['rev-parse', '--show-toplevel'], { run, timeoutMs })) || cwd
  const currentBranch = out(await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], { run, timeoutMs })) || 'HEAD'
  const wantedBranch = branch || currentBranch
  const localFull = out(await git(root, ['rev-parse', 'HEAD'], { run, timeoutMs })) || null
  const remoteUrlResult = await git(root, ['remote', 'get-url', remote], { run, timeoutMs })
  const remoteUrl = remoteUrlResult.code === 0 ? out(remoteUrlResult) : null
  const status = await git(root, ['status', '--porcelain'], { run, timeoutMs })
  const dirtyFiles = out(status).split(/\r?\n/).filter(Boolean)
  const trackingRef = `refs/remotes/${remote}/${wantedBranch}`
  const tracking = await git(root, ['rev-parse', '--verify', '--quiet', trackingRef], { run, timeoutMs })
  const trackingFull = tracking.code === 0 ? out(tracking) : null
  let pending = []
  if (trackingFull) {
    const log = await git(root, ['log', '--oneline', '-n', '50', `${trackingRef}..HEAD`], { run, timeoutMs })
    if (log.code === 0) pending = parsePendingLog(out(log))
  } else if (localFull) {
    // Without a tracking ref every commit is "possibly pending"; report the
    // newest few so the panel is never empty after a fresh clone-less init.
    const log = await git(root, ['log', '--oneline', '-n', '10', 'HEAD'], { run, timeoutMs })
    if (log.code === 0) pending = parsePendingLog(out(log))
  }
  let remoteFull = null
  let remoteError = null
  if (remoteUrl) {
    const attempt = () => git(root, ['ls-remote', '--heads', remote, `refs/heads/${wantedBranch}`], { proxy, run, timeoutMs })
    let listed = await attempt()
    if (listed.code !== 0) listed = await attempt()
    if (listed.code === 0) remoteFull = parseLsRemote(out(listed), wantedBranch)
    else remoteError = classifyGitFailure(`${listed.stderr}${listed.stdout}`)
  }
  const counts = trackingFull && remoteFull
    ? out(await git(root, ['rev-list', '--left-right', '--count', `${trackingRef}...HEAD`], { run, timeoutMs })).split(/\s+/).map(Number)
    : []
  const behind = Number.isFinite(counts[0]) ? counts[0] : null
  const ahead = Number.isFinite(counts[1]) ? counts[1] : (trackingFull ? pending.length : null)
  return {
    ...base,
    ok: true,
    isRepo: true,
    root,
    branch: wantedBranch,
    remote,
    remoteUrl,
    localFull,
    localHead: localFull ? localFull.slice(0, 7) : null,
    remoteFull,
    remoteHead: remoteFull ? remoteFull.slice(0, 7) : null,
    remoteError,
    sameAsRemote: Boolean(localFull && remoteFull && localFull === remoteFull),
    updateAvailable: Boolean(localFull && remoteFull && localFull !== remoteFull),
    behind,
    ahead,
    pending: pending.slice(0, 20),
    pendingCount: trackingFull ? pending.length : null,
    dirty: dirtyFiles.length,
    dirtyFiles: dirtyFiles.slice(0, 5),
  }
}

/**
 * Push with a deadline. The result says whether the tree was killed, what the
 * failure family was, and what is still pending afterwards, so the panel never
 * has to guess whether a silent exit meant success.
 */
export async function pushRepo({ cwd, remote = 'origin', branch = '', proxy = null, timeoutMs = PUSH_TIMEOUT_MS, run = runProcess } = {}) {
  if (!cwd) return { ok: false, error: 'no-repository-configured', failure: 'config' }
  const current = out(await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], { run }))
  const target = branch || current || 'main'
  const result = await git(cwd, ['push', remote, `HEAD:refs/heads/${target}`], { proxy, run, timeoutMs })
  const output = `${result.stdout}${result.stderr}`.trim()
  const timedOut = Boolean(result.timedOut)
  const ok = result.code === 0 && !timedOut
  return {
    ok,
    code: result.code,
    timedOut,
    killed: Boolean(result.killed),
    failure: ok ? null : timedOut ? 'timeout' : classifyGitFailure(output),
    output: output.slice(-2000),
    branch: target,
    pending: ok ? [] : (await pendingCommits(cwd, remote, target, { run })).slice(0, 20),
    pushedAt: ok ? new Date().toISOString() : null,
  }
}

async function pendingCommits(cwd, remote, branch, { run } = {}) {
  const tracking = `refs/remotes/${remote}/${branch}`
  const exists = await git(cwd, ['rev-parse', '--verify', '--quiet', tracking], { run })
  if (exists.code !== 0) return []
  const log = await git(cwd, ['log', '--oneline', '-n', '50', `${tracking}..HEAD`], { run })
  return log.code === 0 ? parsePendingLog(out(log)) : []
}

/** `gh` inherits the proxy from the environment; git needs the `-c` pin. */
export function proxyEnv(proxy, base = process.env) {
  if (!proxy || !proxy.url) return base
  return { ...base, HTTPS_PROXY: proxy.url, HTTP_PROXY: proxy.url, https_proxy: proxy.url, http_proxy: proxy.url }
}

/** `gh repo view` for one `owner/name`, parsed. */
export async function repoView({ gh, nameWithOwner, proxy = null, timeoutMs = VIEW_TIMEOUT_MS, run = runProcess } = {}) {
  if (!gh) return { ok: false, error: 'gh-not-installed' }
  const result = await run(gh, ['repo', 'view', nameWithOwner, '--json', 'nameWithOwner,isPrivate,visibility,pushedAt,defaultBranchRef,diskUsage'], {
    timeoutMs,
    env: proxyEnv(proxy),
  })
  if (result.code !== 0) {
    return { ok: false, error: classifyGitFailure(`${result.stderr}${result.stdout}`), detail: `${result.stderr}${result.stdout}`.trim().slice(-800) }
  }
  try {
    return { ok: true, repo: JSON.parse(result.stdout) }
  } catch {
    return { ok: false, error: 'bad-json', detail: out(result).slice(0, 400) }
  }
}

/**
 * Create a repository from the current worktree and push it. Always private
 * unless `visibility` is explicitly `public`, and the caller must pass
 * `confirm` so a stray click cannot publish a directory.
 */
export async function createRepo({ gh, cwd, name, visibility = 'private', confirm = false, proxy = null, timeoutMs = CREATE_TIMEOUT_MS, run = runProcess } = {}) {
  if (!gh) return { ok: false, error: 'gh-not-installed' }
  if (!confirm) return { ok: false, error: 'confirmation-required' }
  const slug = String(name || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(slug)) return { ok: false, error: 'invalid-name' }
  const visibilityFlag = visibility === 'public' ? '--public' : '--private'
  const result = await run(gh, ['repo', 'create', slug, visibilityFlag, '--source', cwd, '--remote', 'origin', '--push'], {
    timeoutMs,
    env: proxyEnv(proxy),
  })
  const output = `${result.stdout}${result.stderr}`.trim()
  if (result.code !== 0) {
    const failure = classifyGitFailure(output)
    return { ok: false, error: failure === 'unknown' ? 'create-failed' : failure, detail: output.slice(-800) }
  }
  return { ok: true, name: slug, visibility: visibilityFlag === '--public' ? 'public' : 'private', output: output.slice(-800) }
}

/**
 * Shapes worth blocking a push over. The literals are assembled by
 * concatenation so this module never matches itself; lockfile base64 integrity
 * hashes are deliberately absent, only almost-certain live credentials are
 * listed.
 */
const SECRET_PATTERNS = [
  { kind: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'github-token', pattern: new RegExp('\\bgh' + '[pousr]_[A-Za-z0-9]{20,}') },
  { kind: 'github-pat', pattern: new RegExp('\\bgithub' + '_pat_[A-Za-z0-9_]{20,}') },
  { kind: 'aws-access-key', pattern: new RegExp('\\bAK' + 'IA[0-9A-Z]{16}\\b') },
  { kind: 'slack-token', pattern: new RegExp('\\bxox' + '[baprs]-[A-Za-z0-9-]{10,}') },
  { kind: 'openai-key', pattern: new RegExp('\\bsk' + '-[A-Za-z0-9]{20,}') },
  { kind: 'generic-assignment', pattern: /(?:secret|token|password|passwd|api[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]/i },
]

/** Files that are credentials by name, whatever they contain. */
const SECRET_PATH = /(^|\/)(\.env|keys\.json|id_rsa|id_ed25519|credentials(\.json)?|[^/]*token[^/]*\.txt)$|\.pem$/i

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.gz', '.tgz',
  '.pdf', '.woff', '.woff2', '.ttf', '.exe', '.dll', '.node', '.mp4', '.wasm',
])

/**
 * Scan the files git would publish. Run before the first push of a repository
 * that touches credentials: a Tushare/gh token pasted into a config file is
 * invisible to `.gitignore` once it is tracked, and a private repository is not
 * a licence to leak it. Callers may pass `force` after a human looked at the
 * findings.
 */
export async function scanSecrets(cwd, {
  run = runProcess,
  readFile = (path) => readFileSync(path, 'utf8'),
  sizeOf = (path) => statSync(path).size,
  maxBytes = 512 * 1024,
  maxFindings = 50,
  timeoutMs = 15_000,
} = {}) {
  if (!cwd) return { ok: true, findings: [], scanned: 0, files: 0, error: 'no-repository-configured' }
  if (!existsSync(cwd)) return { ok: true, findings: [], scanned: 0, files: 0, error: 'repository-path-missing' }
  const listed = await run('git', ['ls-files', '-z'], { cwd, timeoutMs })
  if (listed.code !== 0) return { ok: true, findings: [], scanned: 0, files: 0, error: 'not-a-git-repository' }
  const files = String(listed.stdout || '').split('\0').filter(Boolean)
  const findings = []
  let scanned = 0
  let skipped = 0
  for (const file of files) {
    if (findings.length >= maxFindings) break
    if (SECRET_PATH.test(file)) {
      findings.push({ file, line: null, kind: 'sensitive-path' })
      continue
    }
    if (BINARY_EXT.has(extname(file).toLowerCase())) {
      skipped += 1
      continue
    }
    let text
    try {
      if (sizeOf(join(cwd, file)) > maxBytes) {
        skipped += 1
        continue
      }
      text = readFile(join(cwd, file))
    } catch {
      skipped += 1
      continue
    }
    if (typeof text !== 'string' || text.includes('\0')) {
      skipped += 1
      continue
    }
    scanned += 1
    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      for (const { kind, pattern } of SECRET_PATTERNS) {
        if (pattern.test(line)) findings.push({ file, line: index + 1, kind })
      }
      if (findings.length >= maxFindings) break
    }
  }
  return {
    ok: findings.length === 0,
    findings: findings.slice(0, maxFindings),
    scanned,
    skipped,
    files: files.length,
  }
}

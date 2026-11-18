import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * GitHub CLI (`gh`) management, merged in from `homerdsh-workbench`. The
 * official change-request / worktree bundle shells out to `gh`, so this
 * plugin can install a pinned managed copy, find one already on PATH, and run
 * the `gh auth login --web` device flow from the settings page.
 *
 * State lives in the plugin directory so it survives profile rebuilds:
 * `<DSH home>/compression-tiers/gh/{bin,download,src}`.
 */

/**
 * Pinned GitHub CLI release. Keep the four assets in step with the version:
 * they are the official per-platform archives from cli/cli.
 */
export const GH_VERSION = '2.76.2'
const GH_RELEASE = `https://github.com/cli/cli/releases/download/v${GH_VERSION}`

/** Where the managed copy comes from; shown next to the version. */
export const GH_SOURCE = 'https://cli.github.com/'

/**
 * Archive integrity: the release host publishes archives over HTTPS, but this
 * plugin pins URLs, not a SHA-256 per asset. Download size and a `gh --version`
 * probe are validated after install; that catches truncated or broken
 * binaries, not a compromised response.
 */

const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const COMMAND_TIMEOUT_MS = 120_000
const EXTRACT_TIMEOUT_MS = 10 * 60_000
const VERIFY_TIMEOUT_MS = 30_000

const GH_ASSETS = {
  'win32-x64': { file: `gh_${GH_VERSION}_windows_amd64.zip`, kind: 'zip' },
  'win32-arm64': { file: `gh_${GH_VERSION}_windows_arm64.zip`, kind: 'zip' },
  'linux-x64': { file: `gh_${GH_VERSION}_linux_amd64.tar.gz`, kind: 'tar.gz' },
  'linux-arm64': { file: `gh_${GH_VERSION}_linux_arm64.tar.gz`, kind: 'tar.gz' },
}

export function ghRoot(home) {
  return join(home, 'compression-tiers', 'gh')
}

export function ghBinDir(home) {
  return join(ghRoot(home), 'bin')
}

export function ghBinaryName(platform = process.platform) {
  return platform === 'win32' ? 'gh.exe' : 'gh'
}

/** The pinned archive for one platform/arch, or null when no build exists. */
export function ghAsset(platform = process.platform, arch = process.arch) {
  const asset = GH_ASSETS[`${platform}-${arch}`]
  if (!asset) return null
  return { ...asset, url: `${GH_RELEASE}/${asset.file}` }
}

function downloadDir(home) {
  return join(ghRoot(home), 'download')
}

function partPath(home, asset) {
  return join(downloadDir(home), `${asset.file}.part`)
}

/** Find an executable on PATH without spawning it. */
export function systemGh(platform = process.platform, envPath = process.env.PATH) {
  const binary = ghBinaryName(platform)
  const dirs = String(envPath || '').split(platform === 'win32' ? ';' : ':')
  for (const raw of dirs) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1')
    if (!dir) continue
    const candidate = join(dir, binary)
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    } catch {
      // Ignore unreadable PATH entries and keep looking.
    }
  }
  return null
}

/** The managed binary, then a system one, then null. */
export function resolveGh(home, platform = process.platform, envPath = process.env.PATH) {
  const managed = join(ghBinDir(home), ghBinaryName(platform))
  if (existsSync(managed)) return managed
  return systemGh(platform, envPath)
}

/** Live progress for the running download, keyed by home. */
const jobs = new Map()

function jobKey(home) {
  return home
}

/**
 * Everything the settings panel needs about the managed component: how far a
 * download got, whether a binary is installed, and what PATH already offers.
 */
export function ghStatus(home, { platform = process.platform, arch = process.arch, envPath = process.env.PATH } = {}) {
  const asset = ghAsset(platform, arch)
  const job = jobs.get(jobKey(home))
  const bin = join(ghBinDir(home), ghBinaryName(platform))
  const hasBinary = existsSync(bin)
  // A failed job keeps the component "not installed" even if a binary is still
  // on disk: the panel then offers a retry instead of a broken install.
  const installed = hasBinary && !job?.error
  const systemPath = installed ? null : systemGh(platform, envPath)
  const partBytes = asset && existsSync(partPath(home, asset)) ? statSync(partPath(home, asset)).size : 0
  let state = 'missing'
  if (job?.running) state = 'downloading'
  else if (installed) state = 'installed'
  else if (job?.error) state = 'error'
  else if (systemPath) state = 'system'
  else if (partBytes > 0) state = 'partial'
  const received = job?.running ? job.received : partBytes
  const total = job?.running ? job.total ?? null : null
  return {
    id: 'gh',
    name: 'GitHub CLI',
    version: GH_VERSION,
    source: GH_SOURCE,
    supported: Boolean(asset),
    url: asset?.url || null,
    file: asset?.file || null,
    kind: asset?.kind || null,
    state,
    installed,
    system: systemPath !== null,
    systemPath,
    binaryPath: installed ? bin : systemPath,
    sourceKind: installed ? 'managed' : systemPath ? 'system' : null,
    received,
    total,
    percent: total ? Math.min(100, Math.round((received / total) * 100)) : null,
    error: job?.error || null,
    installDir: ghRoot(home),
  }
}

async function fetchKeepingRange(url, headers, signal, fetchImpl, hops = 0) {
  const response = await fetchImpl(url, { headers, signal, redirect: 'manual' })
  if ([301, 302, 303, 307, 308].includes(response.status) && hops < 5) {
    const location = response.headers.get('location')
    if (!location) throw new Error('redirect had no Location header')
    return fetchKeepingRange(new URL(location, url).href, headers, signal, fetchImpl, hops + 1)
  }
  return response
}

/**
 * Download with HTTP `Range` resume: an interrupted run keeps its `.part`
 * file and the next attempt continues from its byte offset. A `416` means the
 * partial file belongs to another version, so it is dropped and refetched.
 */
export async function downloadWithResume({ url, partPath: target, fetchImpl = fetch, onProgress, signal }) {
  mkdirSync(dirname(target), { recursive: true })
  let existing = existsSync(target) ? statSync(target).size : 0
  const request = (resume) => fetchKeepingRange(
    url,
    resume && existing > 0 ? { Range: `bytes=${existing}-` } : {},
    signal,
    fetchImpl,
  )
  let response = await request(true)
  if (response.status === 416) {
    rmSync(target, { force: true })
    existing = 0
    response = await request(false)
  }
  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`download failed HTTP ${response.status}`)
  }
  const restart = response.status === 200
  const contentRange = response.headers.get('content-range') || ''
  const lengthHeader = Number(response.headers.get('content-length'))
  const rangeTotal = /\/(\d+)\s*$/.exec(contentRange)
  const total = rangeTotal
    ? Number(rangeTotal[1])
    : (Number.isFinite(lengthHeader) ? (restart ? lengthHeader : existing + lengthHeader) : null)
  let received = restart ? 0 : existing
  onProgress?.({ received, total, resumedFrom: restart ? 0 : existing })
  const body = response.body
  if (!body) throw new Error('download response had no body')
  const file = createWriteStream(target, { flags: restart ? 'w' : 'a' })
  const source = typeof body.getReader === 'function' ? Readable.fromWeb(body) : body
  source.on('data', (chunk) => {
    received += chunk.length
    onProgress?.({ received, total, resumedFrom: restart ? 0 : existing })
  })
  await pipeline(source, file)
  return { received, total, resumedFrom: restart ? 0 : existing }
}

function runCommand(command, args, { timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      // On Windows an invalid executable can throw from spawn() itself.
      resolve({ code: 127, stdout: '', stderr: error && error.message ? error.message : String(error) })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // A child that already exited has nothing to kill.
      }
      finish({ code: 124, stdout, stderr: `${stderr}\ncommand timed out after ${timeoutMs} ms: ${command}`.trim() })
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => finish({ code: 127, stdout, stderr: error.message }))
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }))
  })
}

/** Extract a zip with the platform `tar` (bsdtar reads zip), then PowerShell. */
async function extractArchive(archivePath, destDir, kind, platform = process.platform) {
  mkdirSync(destDir, { recursive: true })
  if (kind === 'tar.gz') {
    const extracted = await runCommand('tar', ['-xzf', archivePath, '-C', destDir], { timeoutMs: EXTRACT_TIMEOUT_MS })
    if (extracted.code === 0) return
    throw new Error(extracted.stderr.slice(-400) || 'extract failed')
  }
  if (kind === 'zip') {
    const extracted = await runCommand('tar', ['-xf', archivePath, '-C', destDir], { timeoutMs: EXTRACT_TIMEOUT_MS })
    if (extracted.code === 0) return
    if (platform === 'win32') {
      const powershell = await runCommand('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
        archivePath, destDir,
      ], { timeoutMs: EXTRACT_TIMEOUT_MS })
      if (powershell.code === 0) return
      throw new Error(powershell.stderr.slice(-400) || extracted.stderr.slice(-400) || 'extract failed')
    }
    throw new Error(extracted.stderr.slice(-400) || 'extract failed')
  }
  throw new Error(`unsupported archive kind: ${kind}`)
}

/** First file with this name anywhere below `dir`. */
export function findBinary(dir, name) {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findBinary(path, name)
      if (found) return found
    } else if (entry.name === name) return path
  }
  return null
}

function pruneDownload(home) {
  const staging = join(ghRoot(home), 'src')
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
  if (existsSync(downloadDir(home))) rmSync(downloadDir(home), { recursive: true, force: true })
}

function stagedPath(destination) {
  return `${destination}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function stageBinary(source, destination, platform) {
  const temp = stagedPath(destination)
  try {
    copyFileSync(source, temp)
    if (platform !== 'win32') chmodSync(temp, 0o755)
    const staged = statSync(temp)
    const original = statSync(source)
    if (!staged.isFile() || staged.size === 0 || staged.size !== original.size) {
      throw new Error(`staged copy of ${basename(destination)} is incomplete`)
    }
    return temp
  } catch (error) {
    try {
      rmSync(temp, { force: true })
    } catch {
      // A temp file that never got created needs no cleanup.
    }
    throw error
  }
}

/**
 * Rename the staged binary into place and probe it. The previous binary is
 * backed up first and restored on any failure, so an install either fully
 * replaces `gh` or leaves the previous state untouched.
 */
async function installBinary(temp, final, platform) {
  let backup = null
  let installed = false
  try {
    const stagedCheck = await runCommand(temp, ['--version'], { timeoutMs: VERIFY_TIMEOUT_MS })
    if (stagedCheck.code !== 0) {
      const detail = `${stagedCheck.stderr}${stagedCheck.stdout}`.trim().slice(-400)
      throw new Error(`GitHub CLI staged probe failed: ${detail || `exit ${stagedCheck.code}`}`)
    }
    if (existsSync(final)) {
      backup = `${final}.old-${process.pid}-${Date.now()}`
      renameSync(final, backup)
    }
    renameSync(temp, final)
    installed = true
    const check = await runCommand(final, ['--version'], { timeoutMs: VERIFY_TIMEOUT_MS })
    if (check.code !== 0) {
      const detail = `${check.stderr}${check.stdout}`.trim().slice(-400)
      throw new Error(`GitHub CLI probe after install failed: ${detail || `exit ${check.code}`}`)
    }
    if (backup) {
      try {
        rmSync(backup, { force: true })
      } catch {
        // A leftover backup is harmless; the installed binary already verified.
      }
    }
  } catch (error) {
    try {
      if (installed) rmSync(final, { force: true })
    } catch {
      // Keep restoring the older copy even if the new file is locked.
    }
    try {
      if (backup && existsSync(backup)) renameSync(backup, final)
    } catch {
      // Best effort; the caller still reports the install error.
    }
    try {
      if (existsSync(temp)) rmSync(temp, { force: true })
    } catch {
      // Temp cleanup must not hide the install result.
    }
    throw error
  }
}

/**
 * Start the managed download in the background and return the current status
 * immediately: the panel polls {@link ghStatus} for progress and the outcome.
 */
export function startGhDownload(home, { platform = process.platform, arch = process.arch } = {}) {
  const asset = ghAsset(platform, arch)
  if (!asset) throw new Error(`GitHub CLI has no build for ${platform}/${arch}`)
  const current = jobs.get(jobKey(home))
  if (current?.running) return ghStatus(home, { platform, arch })
  const job = { running: true, received: 0, total: null, error: null }
  jobs.set(jobKey(home), job)
  const target = partPath(home, asset)
  // A stalled connection must not leave the job "downloading" forever.
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('download timed out after 10 minutes'))
  }, DOWNLOAD_TIMEOUT_MS)
  if (typeof timer.unref === 'function') timer.unref()
  downloadWithResume({
    url: asset.url,
    partPath: target,
    signal: controller.signal,
    onProgress: (progress) => {
      job.received = progress.received
      job.total = progress.total
    },
  }).then(async () => {
    clearTimeout(timer)
    const archivePath = join(downloadDir(home), asset.file)
    renameSync(target, archivePath)
    const staging = join(ghRoot(home), 'src')
    await extractArchive(archivePath, staging, asset.kind, platform)
    const binaryName = ghBinaryName(platform)
    const binary = findBinary(staging, binaryName)
    if (!binary) throw new Error(`archive did not contain ${binaryName}`)
    const binDir = ghBinDir(home)
    mkdirSync(binDir, { recursive: true })
    const final = join(binDir, binaryName)
    const temp = stageBinary(binary, final, platform)
    await installBinary(temp, final, platform)
    try {
      pruneDownload(home)
    } catch {
      // Cleanup is best effort: a leftover archive must not fail the install.
    }
    prependGhPath(home, platform)
  }).catch((error) => {
    job.error = timedOut
      ? 'download timed out after 10 minutes; the partial file was kept for resume'
      : error instanceof Error ? error.message : String(error)
  }).finally(() => {
    clearTimeout(timer)
    job.running = false
  })
  return ghStatus(home, { platform, arch })
}

/**
 * Put the managed `bin` directory first on PATH so the official change-request
 * bundle finds the managed `gh`. Returns whether any managed binary exists.
 */
export function prependGhPath(home, platform = process.platform) {
  const dir = ghBinDir(home)
  if (!existsSync(join(dir, ghBinaryName(platform)))) return false
  const current = process.env.PATH || ''
  const separator = platform === 'win32' ? ';' : ':'
  if (current.split(separator).includes(dir)) return true
  process.env.PATH = `${dir}${separator}${current}`
  return true
}

export function parseGhAuthStatus(output) {
  const account = /Logged in to github\.com account ([^\s(]+)/i.exec(String(output || ''))?.[1] || null
  return { authenticated: Boolean(account), account }
}

/**
 * Ask `gh` whether github.com is logged in. The panel needs a yes/no and the
 * account name, so plain `gh auth status` output is parsed instead of `--json`
 * flags that older releases lack.
 */
export async function ghAuthStatus(home, { platform = process.platform, arch = process.arch, envPath = process.env.PATH } = {}) {
  const gh = resolveGh(home, platform, envPath)
  if (!gh) return { available: false, authenticated: false, account: null, path: null, version: null, detail: '' }
  const result = await runCommand(gh, ['auth', 'status'], { timeoutMs: VERIFY_TIMEOUT_MS })
  const version = await runCommand(gh, ['--version'], { timeoutMs: VERIFY_TIMEOUT_MS })
  const detail = `${result.stdout}${result.stderr}`.trim()
  const parsed = parseGhAuthStatus(detail)
  const firstLine = `${version.stdout}${version.stderr}`.trim().split(/\r?\n/)[0] || ''
  const versionText = /gh version (\S+)/i.exec(firstLine)?.[1] || null
  return {
    available: true,
    authenticated: result.code === 0 && parsed.authenticated,
    account: parsed.account,
    path: gh,
    version: versionText,
    detail,
  }
}

/** Device-code page `gh` sends the user to once the flow starts. */
const GH_DEVICE_URL = 'https://github.com/login/device'

/** One-time code `gh` prints, e.g. `ABCD-1234`. */
const GH_CODE = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/

/**
 * Live `gh auth login --web` child. `gh` prints a one-time device code first
 * and then waits for Enter before it opens the browser, so the dialog shows the
 * code and clicks through instead of sending the user to a terminal.
 */
let loginSession = null

function loginSnapshot() {
  if (!loginSession) {
    return { active: false, state: 'idle', code: null, url: null, note: '', error: null, startedAt: null }
  }
  return {
    active: loginSession.state === 'starting' || loginSession.state === 'waiting',
    state: loginSession.state,
    code: loginSession.code,
    url: loginSession.url,
    note: loginSession.note,
    error: loginSession.error,
    startedAt: loginSession.startedAt,
  }
}

export function githubLoginStatus() {
  return loginSnapshot()
}

/** Stop the device-flow child; its state is dropped so a fresh code can start. */
export function cancelGithubLogin() {
  const session = loginSession
  loginSession = null
  if (!session) return { canceled: false, ...loginSnapshot() }
  try {
    session.child.kill()
  } catch {
    // A child that already exited needs no cleanup.
  }
  return { canceled: true, ...loginSnapshot() }
}

/**
 * Start `gh auth login --web` for github.com over HTTPS. The child runs in the
 * background: it prints the code, receives Enter so it opens the browser, then
 * polls GitHub. Callers poll {@link githubLoginStatus} for the outcome.
 */
export function beginGithubLogin(home, { platform = process.platform, envPath = process.env.PATH } = {}) {
  const live = loginSession
  if (live && (live.state === 'starting' || live.state === 'waiting')) {
    return { started: false, reused: true, command: live.command, ...loginSnapshot() }
  }
  const gh = resolveGh(home, platform, envPath)
  if (!gh) throw new Error('GitHub CLI is not installed yet; download it first')
  const args = ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https']
  const command = `"${gh}" ${args.join(' ')}`
  const child = spawn(gh, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const session = {
    child,
    command,
    state: 'starting',
    code: null,
    url: GH_DEVICE_URL,
    note: '',
    error: null,
    startedAt: Date.now(),
  }
  loginSession = session
  let output = ''
  let advanced = false
  /** gh waits on stdin; send the Enter that continues the flow exactly once. */
  const pressEnter = () => {
    if (advanced) return
    advanced = true
    try {
      child.stdin.end('\n')
    } catch {
      // A closed stdin means the flow already moved on or the child exited.
    }
  }
  const collect = (chunk) => {
    output += chunk
    if (!session.code) {
      const code = GH_CODE.exec(output.toUpperCase())
      if (code) {
        session.code = code[1]
        session.state = 'waiting'
        session.note = 'copy the one-time code, then paste it on the GitHub page'
        pressEnter()
      }
    }
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  // gh still needs Enter when its wording changes; never leave it hanging.
  const fallback = setTimeout(pressEnter, 2500)
  if (typeof fallback.unref === 'function') fallback.unref()
  child.on('error', (error) => {
    clearTimeout(fallback)
    if (loginSession !== session) return
    session.state = 'error'
    session.error = error instanceof Error ? error.message : String(error)
    session.note = ''
  })
  child.on('close', (exitCode) => {
    clearTimeout(fallback)
    if (loginSession !== session) return
    if (exitCode === 0) {
      session.state = 'success'
      session.note = 'authorization finished; gh stored the credential in its own store'
      return
    }
    session.state = 'error'
    session.note = ''
    const tail = output.trim().split(/\r?\n/).filter(Boolean).slice(-3).join('\n')
    session.error = tail || `gh auth login exited with code ${exitCode ?? 1}`
  })
  return { started: true, reused: false, command, ...loginSnapshot() }
}

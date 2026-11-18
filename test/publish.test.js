import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifyGitFailure,
  createRepo,
  detectProxy,
  networkReport,
  normalizeProxyUrl,
  parseLsRemote,
  parsePendingLog,
  parseProxyServer,
  parseRegistryProxy,
  probeHost,
  proxyEnv,
  pushRepo,
  repoSnapshot,
  resolveRepoPath,
  scanSecrets,
} from '../src/publish.js'

function ok(stdout) {
  return { code: 0, stdout, stderr: '', timedOut: false, killed: false }
}

function fail(stderr, code = 128) {
  return { code, stdout: '', stderr, timedOut: false, killed: false }
}

/** A real directory: `repoSnapshot` refuses a path that does not exist. */
function tempRepo() {
  return mkdtempSync(join(tmpdir(), 'publish-test-'))
}

/** A `git` stub: first matching pattern wins, unmatched calls fail. */
function fakeRun(routes) {
  const calls = []
  const run = async (command, args, options = {}) => {
    const line = args.join(' ')
    calls.push({ command, args, options })
    for (const [pattern, result] of routes) {
      if (pattern.test(line)) return typeof result === 'function' ? result(line, options) : result
    }
    return fail('fatal: unexpected command')
  }
  run.calls = calls
  return run
}

test('proxy values are normalized or rejected', () => {
  assert.deepEqual(normalizeProxyUrl('127.0.0.1:18081'), { url: 'http://127.0.0.1:18081', host: '127.0.0.1', port: 18081 })
  assert.deepEqual(normalizeProxyUrl('http://127.0.0.1:8080/'), { url: 'http://127.0.0.1:8080', host: '127.0.0.1', port: 8080 })
  assert.deepEqual(normalizeProxyUrl('https://proxy.local'), { url: 'https://proxy.local', host: 'proxy.local', port: 443 })
  assert.equal(normalizeProxyUrl(''), null)
  assert.equal(normalizeProxyUrl('direct'), null)
  assert.equal(normalizeProxyUrl('socks5://127.0.0.1:1080'), null)
})

test('the Windows per-protocol proxy value keeps the https entry', () => {
  assert.deepEqual(parseProxyServer('127.0.0.1:18081'), { url: 'http://127.0.0.1:18081', host: '127.0.0.1', port: 18081 })
  assert.deepEqual(parseProxyServer('http=127.0.0.1:18080;https=127.0.0.1:18081'), { url: 'http://127.0.0.1:18081', host: '127.0.0.1', port: 18081 })
  assert.equal(parseProxyServer(''), null)
})

test('registry output is parsed into enabled state and server', () => {
  const text = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
    '    ProxyEnable    REG_DWORD    0x1',
    '    ProxyServer    REG_SZ    127.0.0.1:18081',
  ].join('\r\n')
  const parsed = parseRegistryProxy(text)
  assert.equal(parsed.enabled, true)
  assert.equal(parsed.server, '127.0.0.1:18081')
  assert.equal(parsed.proxy.port, 18081)
  assert.deepEqual(parseRegistryProxy('    ProxyEnable    REG_DWORD    0x0'), { enabled: false, server: null, proxy: null })
})

test('git failures are classified into one cause', () => {
  assert.equal(classifyGitFailure("fatal: unable to access 'https://github.com/x/y.git/': Failed to connect to github.com:443 after 21103 ms"), 'network')
  assert.equal(classifyGitFailure("fatal: unable to access '...': Recv failure: Connection was reset"), 'network')
  assert.equal(classifyGitFailure('fatal: unable to access: Could not resolve host: github.com'), 'dns')
  assert.equal(classifyGitFailure('fatal: Authentication failed for "https://github.com/x/y.git/"'), 'auth')
  assert.equal(classifyGitFailure('remote: Permission to x/y.git denied to z.'), 'auth')
  assert.equal(classifyGitFailure('! [rejected]        main -> main (non-fast-forward)'), 'non-fast-forward')
  assert.equal(classifyGitFailure('command timed out after 60000 ms: git'), 'timeout')
  assert.equal(classifyGitFailure('fatal: repository "x/y" not found'), 'missing-repo')
  assert.equal(classifyGitFailure('something else'), 'unknown')
})

test('ls-remote and log output are parsed', () => {
  const ls = 'a'.repeat(40) + '\trefs/heads/main\n' + 'b'.repeat(40) + '\trefs/heads/dev\n'
  assert.equal(parseLsRemote(ls, 'main'), 'a'.repeat(40))
  assert.equal(parseLsRemote(ls, 'dev'), 'b'.repeat(40))
  assert.equal(parseLsRemote(ls, 'missing'), null)
  assert.deepEqual(parsePendingLog('abc1234 fix: one\nnot a log line\n'), [{ hash: 'abc1234', subject: 'fix: one' }])
})

test('probeHost reports DNS and TCP separately', async () => {
  const good = await probeHost('github.com', 443, {
    lookup: async () => [{ address: '140.82.112.3', family: 4 }],
    connect: () => {
      const socket = { setTimeout() {}, once(event, handler) { if (event === 'connect') setTimeout(handler, 0) }, destroy() {} }
      return socket
    },
  })
  assert.equal(good.knownGithub, true)
  assert.equal(good.tcp.ok, true)

  const bad = await probeHost('github.com', 443, {
    lookup: async () => {
      const error = new Error('ENOTFOUND')
      error.code = 'ENOTFOUND'
      throw error
    },
    connect: () => {
      const socket = { setTimeout() {}, once(event, handler) { if (event === 'error') setTimeout(() => handler({ code: 'ETIMEDOUT' }), 0) }, destroy() {} }
      return socket
    },
  })
  assert.equal(bad.dnsError, 'ENOTFOUND')
  assert.equal(bad.tcp.ok, false)
  assert.equal(bad.tcp.error, 'ETIMEDOUT')
})

test('the network verdict distinguishes direct, proxy, dead proxy and blocked', async () => {
  const lookup = async () => [{ address: '140.82.112.3', family: 4 }]
  const reachable = (host, port) => ({
    setTimeout() {},
    once(event, handler) {
      if (event === 'connect') setTimeout(handler, 0)
    },
    destroy() {},
  })
  const unreachable = (host, port) => ({
    setTimeout() {},
    once(event, handler) {
      if (event === 'error') setTimeout(() => handler({ code: 'ECONNREFUSED' }), 0)
    },
    destroy() {},
  })
  const regOn = async () => ok('    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    127.0.0.1:18081')
  const upstream = async () => ({ status: 200 })
  const brokenHttps = async () => {
    throw Object.assign(new Error('wrong certificate'), { code: 'CERT_MISMATCH' })
  }

  const direct = await networkReport({ platform: 'win32', run: fakeRun([[/query HKCU/, regOn]]), lookup, connect: reachable, fetchImpl: upstream })
  assert.equal(direct.verdict, 'direct')
  assert.equal(direct.proxy.port, 18081)
  assert.equal(direct.proxy.reachable, true)
  assert.equal(direct.https.ok, true)

  const viaProxy = await networkReport({
    platform: 'win32',
    run: fakeRun([[/query HKCU/, regOn]]),
    lookup,
    connect: (options) => (options && options.host === 'github.com' ? unreachable() : reachable()),
    fetchImpl: brokenHttps,
  })
  assert.equal(viaProxy.verdict, 'proxy')
  assert.equal(viaProxy.https.error, 'CERT_MISMATCH')

  const dead = await networkReport({
    platform: 'win32',
    run: fakeRun([[/query HKCU/, regOn]]),
    lookup,
    connect: () => unreachable(),
    fetchImpl: brokenHttps,
  })
  assert.equal(dead.verdict, 'proxy-dead')

  const blocked = await networkReport({
    platform: 'win32',
    run: fakeRun([[/query HKCU/, async () => ok('    ProxyEnable    REG_DWORD    0x0')]]),
    lookup,
    connect: unreachable,
    fetchImpl: brokenHttps,
  })
  assert.equal(blocked.verdict, 'blocked')
  assert.equal(blocked.proxy, null)
})

test('a TCP connection alone does not prove GitHub is reachable', async () => {
  // A poisoned name accepts the TCP handshake; only the HTTPS probe notices.
  const report = await networkReport({
    platform: 'win32',
    run: fakeRun([[/query HKCU/, async () => ok('    ProxyEnable    REG_DWORD    0x0')]]),
    lookup: async () => [{ address: '20.6.7.17', family: 4 }],
    connect: () => ({
      setTimeout() {},
      once(event, handler) {
        if (event === 'connect') setTimeout(handler, 0)
      },
      destroy() {},
    }),
    fetchImpl: async () => {
      throw Object.assign(new Error('wrong certificate'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
    },
  })
  assert.equal(report.direct.ok, true)
  assert.equal(report.https.ok, false)
  assert.equal(report.verdict, 'blocked')
  assert.equal(report.dns.knownGithub, false)
})

test('the explicit proxy beats git and the system', async () => {
  const run = fakeRun([
    [/config --get http\.proxy/, ok('http://10.0.0.5:3128\n')],
    [/query HKCU/,  async () => ok('    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    127.0.0.1:18081')],
  ])
  const explicit = await detectProxy({ cwd: 'C:/repo', override: '127.0.0.1:7890', platform: 'win32', run })
  assert.equal(explicit.source, 'override')
  assert.equal(explicit.proxy.port, 7890)
  const fromGit = await detectProxy({ cwd: 'C:/repo', platform: 'win32', run })
  assert.equal(fromGit.source, 'git')
  assert.equal(fromGit.proxy.port, 3128)
})

test('repoSnapshot reports heads, pending commits and dirt', async () => {
  const head = 'c'.repeat(40)
  const remote = 'd'.repeat(40)
  const run = fakeRun([
    [/--is-inside-work-tree/, ok('true\n')],
    [/--show-toplevel/, ok('C:/repo\n')],
    [/--abbrev-ref HEAD/, ok('main\n')],
    [/rev-list --left-right --count/, ok('1\t2\n')],
    [/rev-parse HEAD/, ok(head + '\n')],
    [/remote get-url origin/, ok('https://github.com/o/r.git\n')],
    [/status --porcelain/, ok(' M src/a.js\n?? new.txt\n')],
    [/--verify --quiet refs\/remotes\/origin\/main/, ok(remote + '\n')],
    [/log --oneline -n 50/, ok('abc1234 fix: one\ndef5678 feat: two\n')],
    [/ls-remote --heads origin refs\/heads\/main/, ok(remote + '\trefs/heads/main\n')],
  ])
  const cwd = tempRepo()
  try {
    const snapshot = await repoSnapshot({ cwd, remote: 'origin', branch: 'main', run })
    assert.equal(snapshot.ok, true)
    assert.equal(snapshot.branch, 'main')
    assert.equal(snapshot.remote, 'origin')
    assert.equal(snapshot.localHead, head.slice(0, 7))
    assert.equal(snapshot.remoteHead, remote.slice(0, 7))
    assert.equal(snapshot.sameAsRemote, false)
    assert.equal(snapshot.updateAvailable, true)
    assert.equal(snapshot.pendingCount, 2)
    assert.equal(snapshot.behind, 1)
    assert.equal(snapshot.dirty, 2)
    assert.equal(snapshot.remoteUrl, 'https://github.com/o/r.git')
    assert.equal(snapshot.pending[0].hash, 'abc1234')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('repoSnapshot fails soft for a missing or non-git path', async () => {  const cwd = tempRepo()
  try {
    assert.equal((await repoSnapshot({ cwd: '', run: fakeRun([]) })).error, 'no-repository-configured')
    const notRepo = await repoSnapshot({ cwd, run: fakeRun([[/--is-inside-work-tree/, fail('fatal: not a git repository')]]) })
    assert.equal(notRepo.ok, false)
    assert.equal(notRepo.error, 'not-a-git-repository')
    const missing = await repoSnapshot({ cwd: join(cwd, 'nope'), run: fakeRun([]) })
    assert.equal(missing.error, 'repository-path-missing')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('pushRepo pins the proxy, disables prompts and reports the outcome', async () => {
  let pushArgs = null
  let pushEnv = null
  const run = fakeRun([
    [/--abbrev-ref HEAD/, ok('main\n')],
    [/push origin HEAD:refs\/heads\/main/, (line, options) => {
      pushArgs = line
      pushEnv = options.env
      return ok('To https://github.com/o/r.git\n')
    }],
    [/--verify --quiet/, ok('e'.repeat(40) + '\n')],
    [/log --oneline -n 50/, ok('')],
  ])
  const result = await pushRepo({ cwd: 'C:/repo', proxy: { url: 'http://127.0.0.1:18081' }, run })
  assert.equal(result.ok, true)
  assert.equal(result.failure, null)
  assert.equal(pushArgs, '-c http.proxy=http://127.0.0.1:18081 push origin HEAD:refs/heads/main')
  assert.equal(pushEnv.GIT_TERMINAL_PROMPT, '0')
  assert.equal(pushEnv.GCM_INTERACTIVE, 'never')
})

test('a hung push is killed and classified as a timeout', async () => {
  const run = fakeRun([
    [/--abbrev-ref HEAD/, ok('main\n')],
    [/push origin HEAD:refs\/heads\/main/, () => ({ code: 124, stdout: '', stderr: '', timedOut: true, killed: true })],
  ])
  const result = await pushRepo({ cwd: 'C:/repo', timeoutMs: 10, run })
  assert.equal(result.ok, false)
  assert.equal(result.timedOut, true)
  assert.equal(result.killed, true)
  assert.equal(result.failure, 'timeout')
})

test('a network failure keeps the pending list for the panel', async () => {
  const run = fakeRun([
    [/--abbrev-ref HEAD/, ok('main\n')],
    [/push origin HEAD:refs\/heads\/main/, fail("fatal: unable to access 'https://github.com/o/r.git/': Failed to connect to github.com:443 after 21103 ms")],
    [/--verify --quiet/, ok('f'.repeat(40) + '\n')],
    [/log --oneline -n 50/, ok('abc1234 fix: one\n')],
  ])
  const result = await pushRepo({ cwd: 'C:/repo', run })
  assert.equal(result.ok, false)
  assert.equal(result.failure, 'network')
  assert.equal(result.pending.length, 1)
  assert.equal(result.pending[0].hash, 'abc1234')
})

test('creating a repository needs explicit confirmation and defaults to private', async () => {
  const run = fakeRun([[/repo create/, ok('https://github.com/o/r\n')]])
  const refused = await createRepo({ gh: 'gh', cwd: 'C:/repo', name: 'r', run })
  assert.equal(refused.ok, false)
  assert.equal(refused.error, 'confirmation-required')
  assert.equal(run.calls.length, 0)

  const created = await createRepo({ gh: 'gh', cwd: 'C:/repo', name: 'r', confirm: true, run })
  assert.equal(created.ok, true)
  assert.equal(created.visibility, 'private')
  assert.match(run.calls[0].args.join(' '), /repo create r --private --source C:\/repo --remote origin --push/)

  const invalid = await createRepo({ gh: 'gh', cwd: 'C:/repo', name: 'bad name', confirm: true, run })
  assert.equal(invalid.error, 'invalid-name')
})

test('gh commands receive the proxy through the environment', () => {
  const env = proxyEnv({ url: 'http://127.0.0.1:18081' }, { PATH: 'x' })
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:18081')
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:18081')
  assert.equal(env.PATH, 'x')
  assert.deepEqual(proxyEnv(null, { PATH: 'x' }), { PATH: 'x' })
})

test('repoSnapshot falls back to the current branch when none is configured', async () => {
  const cwd = tempRepo()
  try {
    const run = fakeRun([
      [/--is-inside-work-tree/, ok('true\n')],
      [/--show-toplevel/, ok('C:/repo\n')],
      [/--abbrev-ref HEAD/, ok('master\n')],
      [/rev-parse HEAD/, ok('a'.repeat(40) + '\n')],
      [/remote get-url origin/, fail('fatal: No such remote')],
      [/status --porcelain/, ok('')],
      [/--verify --quiet/, fail('')],
      [/log --oneline -n 10 HEAD/, ok('abc1234 init\n')],
    ])
    const snapshot = await repoSnapshot({ cwd, run })
    assert.equal(snapshot.branch, 'master')
    assert.equal(snapshot.pendingCount, null)
    assert.equal(snapshot.pending.length, 1)
    assert.equal(snapshot.remoteUrl, null)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('the repository path falls back to the plugin checkout', () => {
  const root = 'C:/plugins/compression'
  const absolute = process.platform === 'win32' ? 'D:/DSH插件/压缩上下文' : '/opt/compression'
  assert.equal(resolveRepoPath({ repoPath: '' }, root), root)
  assert.equal(resolveRepoPath({ repoPath: absolute }, root), absolute)
  assert.equal(resolveRepoPath({ repoPath: 'sub/repo' }, root), join(root, 'sub/repo'))
  assert.equal(resolveRepoPath(null, root), root)
})

test('scanSecrets blocks credential files and token-shaped lines', async () => {
  const cwd = tempRepo()
  try {
    const files = ['src/ok.js', 'config/keys.json', 'src/leak.js']
    const run = fakeRun([[/ls-files -z/, ok(files.join('\0') + '\0')]])
    const tokenValue = 'gh' + 'p_' + 'x'.repeat(30)
    const readFile = (path) => {
      if (path.endsWith('ok.js')) return 'export const one = 1\n'
      if (path.endsWith('leak.js')) return `export const value = '${tokenValue}'\n`
      return ''
    }
    const report = await scanSecrets(cwd, { run, readFile, sizeOf: () => 10 })
    assert.equal(report.ok, false)
    assert.equal(report.files, 3)
    assert.equal(report.findings.some((item) => item.kind === 'sensitive-path' && item.file === 'config/keys.json'), true)
    assert.equal(report.findings.some((item) => item.kind === 'github-token' && item.line === 1), true)
    assert.equal(report.scanned, 2)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('scanSecrets passes a clean worktree and reports a non-repository', async () => {
  const cwd = tempRepo()
  try {
    const clean = await scanSecrets(cwd, {
      run: fakeRun([[/ls-files -z/, ok('index.js\0README.md\0')]]),
      readFile: () => 'export const a = 1\n',
      sizeOf: () => 12,
    })
    assert.equal(clean.ok, true)
    assert.equal(clean.findings.length, 0)
    assert.equal(clean.scanned, 2)

    const notRepo = await scanSecrets(cwd, { run: fakeRun([[/ls-files -z/, fail('fatal: not a git repository')]]) })
    assert.equal(notRepo.ok, true)
    assert.equal(notRepo.error, 'not-a-git-repository')

    const binary = await scanSecrets(cwd, {
      run: fakeRun([[/ls-files -z/, ok('logo.png\0src/a.js\0')]]),
      readFile: () => 'export const a = 1\n',
      sizeOf: () => 12,
    })
    assert.equal(binary.skipped, 1)
    assert.equal(binary.scanned, 1)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasGitEntry, isRepoDir, pushFlow, pushReportText, resolvePushCwd, sessionTarget } from '../src/push-flow.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'compression-tiers-push-'))
}

/** A directory that looks like a checkout. */
function repo(dir) {
  mkdirSync(join(dir, '.git'), { recursive: true })
  return dir
}

test('isRepoDir accepts only existing absolute directories', () => {
  const root = tempDir()
  try {
    assert.equal(isRepoDir(root), true)
    assert.equal(isRepoDir(''), false)
    assert.equal(isRepoDir('relative/path'), false)
    assert.equal(isRepoDir(join(root, 'missing')), false)
    assert.equal(hasGitEntry(root), false)
    assert.equal(hasGitEntry(repo(join(root, 'checkout'))), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolvePushCwd prefers the explicit path over the session directory', () => {
  const root = tempDir()
  try {
    const session = repo(join(root, 'session'))
    const explicit = repo(join(root, 'explicit'))

    assert.deepEqual(
      resolvePushCwd({ explicit, sessionDirectory: session }),
      { cwd: explicit, source: 'explicit', error: null },
    )
    assert.deepEqual(
      resolvePushCwd({ sessionDirectory: session }),
      { cwd: session, source: 'session', error: null },
    )
    // A session directory that is not a checkout is not a repository, and
    // there is no configured fallback to hide that.
    assert.deepEqual(
      resolvePushCwd({ sessionDirectory: join(root, 'plain') }),
      { cwd: null, source: 'none', error: 'no-repository' },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolvePushCwd reports why there is nothing to push', () => {
  const root = tempDir()
  try {
    assert.deepEqual(resolvePushCwd({}), { cwd: null, source: 'none', error: 'no-repository' })
    assert.equal(resolvePushCwd({ explicit: 'relative' }).error, 'repository-path-invalid')
    assert.equal(resolvePushCwd({ explicit: join(root, 'gone') }).error, 'repository-path-invalid')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function deps(overrides = {}) {
  const calls = { detect: [], scan: [], push: [], snapshot: [] }
  return {
    calls,
    detectProxy: async (args) => {
      calls.detect.push(args)
      return { proxy: { url: 'http://127.0.0.1:18081' }, source: 'override' }
    },
    scanSecrets: async (cwd) => {
      calls.scan.push(cwd)
      return { ok: true, findings: [], scanned: 3, files: 3 }
    },
    pushRepo: async (args) => {
      calls.push.push(args)
      return { ok: true, failure: null, branch: 'main', pending: [], pushedAt: '2026-11-19T00:00:00.000Z' }
    },
    repoSnapshot: async (args) => {
      calls.snapshot.push(args)
      return { ok: true, isRepo: true, branch: 'main', localHead: 'abc1234', remoteHead: 'abc1234', pendingCount: 0, pending: [], ahead: 0 }
    },
    ...overrides,
  }
}

test('pushFlow publishes with the detected proxy and reports the repository state', async () => {
  const root = tempDir()
  try {
    const cwd = repo(join(root, 'repo'))
    const fake = deps()
    const flow = await pushFlow({ cwd, settings: { proxy: '127.0.0.1:18081', remote: 'origin', branch: '' }, deps: fake })
    assert.equal(flow.ok, true)
    assert.equal(flow.failure, null)
    assert.equal(flow.forced, false)
    assert.equal(flow.path, cwd)
    assert.equal(flow.proxy.url, 'http://127.0.0.1:18081')
    assert.deepEqual(fake.calls.detect[0], { cwd, override: '127.0.0.1:18081' })
    assert.deepEqual(fake.calls.push[0], { cwd, remote: 'origin', branch: '', proxy: flow.proxy })
    assert.equal(fake.calls.scan.length, 1)
    assert.equal(flow.repo.localHead, 'abc1234')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a secret finding blocks the push until the caller forces it', async () => {
  const root = tempDir()
  try {
    const cwd = repo(join(root, 'repo'))
    const findings = [{ file: 'config.json', line: 4, kind: 'token' }]
    const blockedDeps = deps({ scanSecrets: async () => ({ ok: false, findings, scanned: 1, files: 1 }) })
    const blocked = await pushFlow({ cwd, settings: {}, deps: blockedDeps })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.failure, 'secret-scan')
    assert.deepEqual(blocked.secrets.findings, findings)
    assert.equal(blockedDeps.calls.push.length, 0, 'nothing is published while the scan is red')

    const forcedDeps = deps({ scanSecrets: async () => ({ ok: false, findings, scanned: 1, files: 1 }) })
    const forced = await pushFlow({ cwd, settings: {}, force: true, deps: forcedDeps })
    assert.equal(forced.ok, true)
    assert.equal(forced.forced, true)
    assert.equal(forcedDeps.calls.push.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failing push keeps its failure family and the commits left behind', async () => {
  const root = tempDir()
  try {
    const cwd = repo(join(root, 'repo'))
    const fake = deps({
      pushRepo: async () => ({ ok: false, failure: 'network', timedOut: false, output: 'Recv failure: Connection was reset', pending: ['abc fix'], branch: 'main' }),
      repoSnapshot: async () => ({ ok: true, isRepo: true, branch: 'main', localHead: 'def5678', remoteHead: 'abc1234', pendingCount: 2, pending: ['def second', 'abc fix'], ahead: 2 }),
    })
    const flow = await pushFlow({ cwd, settings: { branch: 'main' }, deps: fake })
    assert.equal(flow.ok, false)
    assert.equal(flow.failure, 'network')
    const text = pushReportText(flow, { path: cwd })
    assert.match(text, /Push failed \(network\)/)
    assert.match(text, /Connection was reset/)
    assert.match(text, /2 commit\(s\) still local/)
    assert.match(text, /def second/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('pushFlow refuses an unusable directory before touching the network', async () => {
  const root = tempDir()
  try {
    const fake = deps()
    const missing = await pushFlow({ cwd: '', settings: {}, deps: fake })
    assert.equal(missing.failure, 'no-repository')
    const invalid = await pushFlow({ cwd: join(root, 'gone'), settings: {}, deps: fake })
    assert.equal(invalid.failure, 'repository-path-invalid')
    assert.equal(fake.calls.detect.length, 0)
    assert.match(pushReportText(missing), /No repository to push/)
    assert.match(pushReportText(invalid, { path: join(root, 'gone') }), /Not a usable repository path/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the report names the block, the timeout and the plain success', () => {
  assert.match(
    pushReportText({ ok: true, proxy: null, repo: { branch: 'main', localHead: 'abc1234', pendingCount: 0, pending: [] } }, { path: 'D:/repo' }),
    /^Pushed main at abc1234 from D:\/repo\.$/,
  )
  const blocked = pushReportText({
    ok: false,
    failure: 'secret-scan',
    secrets: { findings: [{ file: 'a.env', line: null, kind: 'sensitive-path' }] },
  }, { path: 'D:/repo' })
  assert.match(blocked, /Push blocked/)
  assert.match(blocked, /a\.env \(sensitive-path\)/)
  assert.match(blocked, /force/)
  const timeout = pushReportText({
    ok: false,
    failure: 'timeout',
    proxy: { url: 'http://127.0.0.1:18081' },
    push: { failure: 'timeout', timedOut: true, output: '' },
    repo: null,
  }, { path: 'D:/repo' })
  assert.match(timeout, /timed out/)
  assert.match(timeout, /127\.0\.0\.1:18081/)
})

test('a session binding turns the push target into a repository URL', async () => {
  const root = tempDir()
  try {
    const cwd = repo(join(root, 'repo'))
    const target = 'https://github.com/Homer4033/wechat-article-translator.git'
    const fake = deps()
    const flow = await pushFlow({ cwd, settings: { remote: 'origin' }, target, deps: fake })
    assert.equal(flow.ok, true)
    assert.equal(flow.target, target)
    assert.deepEqual(fake.calls.push[0], { cwd, remote: target, branch: '', proxy: flow.proxy })
    // A URL is not a remote name: there is nothing to snapshot.
    assert.equal(fake.calls.snapshot.length, 0)
    assert.equal(flow.repo, null)
    assert.match(pushReportText(flow, { path: cwd }), /^Pushed to https:\/\/github\.com\/Homer4033\/wechat-article-translator\.git from/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a bound target is reported even when the push is refused', async () => {
  const target = 'https://github.com/Homer4033/wechat-article-translator.git'
  const fake = deps()
  const refused = await pushFlow({ cwd: '', settings: {}, target, deps: fake })
  assert.equal(refused.failure, 'no-repository')
  assert.equal(refused.target, target)
  assert.equal(fake.calls.detect.length, 0)
})

test('the session binding is read from the top-level settings, not from github', () => {
  // The regression: `githubSettings()` returns only the `github` block, so
  // indexing it with a session id threw "Cannot read properties of undefined".
  const settings = { github: { remote: 'origin' }, sessionRepos: { 'session-a': 'Homer4033/toolbox' } }
  assert.equal(sessionTarget(settings, 'session-a'), 'https://github.com/Homer4033/toolbox.git')
  assert.equal(sessionTarget(settings, 'session-b'), '')
  assert.equal(sessionTarget(settings, ''), '')
  // A settings file written before sessionRepos existed must not throw.
  assert.equal(sessionTarget({ github: {} }, 'session-a'), '')
  assert.equal(sessionTarget(null, 'session-a'), '')
  assert.equal(sessionTarget(undefined, undefined), '')
})
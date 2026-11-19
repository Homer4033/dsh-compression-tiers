import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GH_VERSION,
  beginGithubLogin,
  cancelGithubLogin,
  downloadWithResume,
  findBinary,
  ghAsset,
  ghBinDir,
  ghBinaryName,
  ghRoot,
  ghStatus,
  githubLoginStatus,
  listRepos,
  parseGhAuthJson,
  parseGhAuthStatus,
  parseRepoList,
  prependGhPath,
  resolveGh,
  systemGh,
} from '../src/gh.js'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'compression-tiers-gh-'))
}

function streamOf(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

test('the pinned asset matrix covers Windows and Linux builds only', () => {
  const win = ghAsset('win32', 'x64')
  assert.equal(win.file, `gh_${GH_VERSION}_windows_amd64.zip`)
  assert.equal(win.kind, 'zip')
  assert.equal(win.url, `https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_windows_amd64.zip`)
  assert.equal(ghAsset('linux', 'arm64').kind, 'tar.gz')
  assert.equal(ghAsset('darwin', 'arm64'), null)
  assert.equal(ghAsset('win32', 'ia32'), null)
})

test('the binary name follows the platform', () => {
  assert.equal(ghBinaryName('win32'), 'gh.exe')
  assert.equal(ghBinaryName('linux'), 'gh')
})

test('systemGh finds an executable on PATH and ignores unreadable entries', () => {
  const home = tempHome()
  try {
    const binDir = join(home, 'fake-bin')
    mkdirSync(binDir, { recursive: true })
    const binary = join(binDir, ghBinaryName('win32'))
    writeFileSync(binary, '')
    const path = `${join(home, 'missing')};${binDir}`
    assert.equal(systemGh('win32', path), binary)
    assert.equal(systemGh('win32', `${join(home, 'missing')}`), null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the managed binary wins over a system one', () => {
  const home = tempHome()
  try {
    const managedDir = ghBinDir(home)
    mkdirSync(managedDir, { recursive: true })
    const managed = join(managedDir, ghBinaryName('linux'))
    writeFileSync(managed, '')
    const systemDir = join(home, 'system-bin')
    mkdirSync(systemDir)
    writeFileSync(join(systemDir, ghBinaryName('linux')), '')
    assert.equal(resolveGh(home, 'linux', systemDir), managed)
    assert.equal(resolveGh(home, 'linux', ''), managed)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('ghStatus reports missing, installed and system states', () => {
  const home = tempHome()
  try {
    const empty = ghStatus(home, { platform: 'linux', arch: 'x64', envPath: '' })
    assert.equal(empty.state, 'missing')
    assert.equal(empty.installed, false)
    assert.equal(empty.supported, true)
    assert.equal(empty.version, GH_VERSION)
    assert.equal(empty.percent, null)

    mkdirSync(ghBinDir(home), { recursive: true })
    writeFileSync(join(ghBinDir(home), 'gh'), '')
    const installed = ghStatus(home, { platform: 'linux', arch: 'x64', envPath: '' })
    assert.equal(installed.state, 'installed')
    assert.equal(installed.binaryPath, join(ghBinDir(home), 'gh'))
    assert.equal(installed.sourceKind, 'managed')
    assert.equal(installed.total, null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a leftover .part file reads as a resumable partial download', () => {
  const home = tempHome()
  try {
    const asset = ghAsset('linux', 'x64')
    const dir = join(ghRoot(home), 'download')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${asset.file}.part`), 'abcde')
    const status = ghStatus(home, { platform: 'linux', arch: 'x64', envPath: '' })
    assert.equal(status.state, 'partial')
    assert.equal(status.received, 5)
    assert.equal(status.total, null)
    assert.equal(status.percent, null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('an unsupported platform reports no build', () => {
  const home = tempHome()
  try {
    const status = ghStatus(home, { platform: 'darwin', arch: 'arm64', envPath: '' })
    assert.equal(status.supported, false)
    assert.equal(status.url, null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('downloadWithResume writes the full body and reports progress', async () => {
  const home = tempHome()
  try {
    const target = join(home, 'download', 'gh.zip.part')
    const body = 'x'.repeat(2048)
    const progress = []
    const fetchImpl = async () => ({
      status: 200,
      headers: new Headers({ 'content-length': String(body.length) }),
      body: streamOf(body),
    })
    const result = await downloadWithResume({
      url: 'https://example.test/gh.zip',
      partPath: target,
      fetchImpl,
      onProgress: (event) => progress.push(event),
    })
    assert.equal(readFileSync(target, 'utf8'), body)
    assert.equal(result.received, body.length)
    assert.equal(result.total, body.length)
    assert.equal(progress.at(-1).received, body.length)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('downloadWithResume resumes from the existing part with a Range request', async () => {
  const home = tempHome()
  try {
    const target = join(home, 'download', 'gh.zip.part')
    mkdirSync(join(home, 'download'), { recursive: true })
    writeFileSync(target, 'aaa')
    let seenRange = null
    const fetchImpl = async (_url, options) => {
      seenRange = options.headers.Range
      return {
        status: 206,
        headers: new Headers({ 'content-range': 'bytes 3-5/6', 'content-length': '3' }),
        body: streamOf('bbb'),
      }
    }
    const result = await downloadWithResume({ url: 'https://example.test/gh.zip', partPath: target, fetchImpl })
    assert.equal(seenRange, 'bytes=3-')
    assert.equal(readFileSync(target, 'utf8'), 'aaabbb')
    assert.equal(result.resumedFrom, 3)
    assert.equal(result.total, 6)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a 416 response drops the stale part and restarts the download', async () => {
  const home = tempHome()
  try {
    const target = join(home, 'download', 'gh.zip.part')
    mkdirSync(join(home, 'download'), { recursive: true })
    writeFileSync(target, 'stale')
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      if (calls === 1) return { status: 416, headers: new Headers({}), body: null }
      return {
        status: 200,
        headers: new Headers({ 'content-length': '4' }),
        body: streamOf('full'),
      }
    }
    await downloadWithResume({ url: 'https://example.test/gh.zip', partPath: target, fetchImpl })
    assert.equal(calls, 2)
    assert.equal(readFileSync(target, 'utf8'), 'full')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('findBinary walks nested archive directories', () => {
  const home = tempHome()
  try {
    const deep = join(home, 'gh_2', 'bin')
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, 'gh.exe'), '')
    assert.equal(findBinary(home, 'gh.exe'), join(deep, 'gh.exe'))
    assert.equal(findBinary(home, 'missing.exe'), null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('prependGhPath puts the managed bin directory first exactly once', () => {
  const home = tempHome()
  const original = process.env.PATH
  try {
    assert.equal(prependGhPath(home, 'win32'), false)
    mkdirSync(ghBinDir(home), { recursive: true })
    writeFileSync(join(ghBinDir(home), 'gh.exe'), '')
    process.env.PATH = 'C:\\Windows;C:\\bin'
    assert.equal(prependGhPath(home, 'win32'), true)
    assert.equal(process.env.PATH, `${ghBinDir(home)};C:\\Windows;C:\\bin`)
    assert.equal(prependGhPath(home, 'win32'), true)
    assert.equal(process.env.PATH, `${ghBinDir(home)};C:\\Windows;C:\\bin`)
  } finally {
    process.env.PATH = original
    rmSync(home, { recursive: true, force: true })
  }
})

test('gh auth status output is reduced to the account name and scopes', () => {
  assert.deepEqual(
    parseGhAuthStatus('github.com\n  ✓ Logged in to github.com account Homer4033 (keyring)\n  - Token scopes: \'repo\', \'read:org\'\n'),
    { authenticated: true, account: 'Homer4033', scopes: ['repo', 'read:org'] },
  )
  assert.deepEqual(parseGhAuthStatus('You are not logged into any GitHub hosts.'), { authenticated: false, account: null, scopes: [] })
  assert.deepEqual(parseGhAuthStatus(''), { authenticated: false, account: null, scopes: [] })
})

test('the JSON auth state carries scopes for the active account', () => {
  const json = JSON.stringify({
    hosts: {
      'github.com': [
        { state: 'failed', active: false, login: 'old' },
        { state: 'success', active: true, login: 'Homer4033', scopes: ['repo', 'read:org'] },
      ],
    },
  })
  assert.deepEqual(parseGhAuthJson(json), { authenticated: true, account: 'Homer4033', scopes: ['repo', 'read:org'] })
  const stringScopes = JSON.stringify({ hosts: { 'github.com': [{ state: 'success', login: 'x', scopes: 'gist, read:org' }] } })
  assert.deepEqual(parseGhAuthJson(stringScopes), { authenticated: true, account: 'x', scopes: ['gist', 'read:org'] })
  assert.deepEqual(parseGhAuthJson('not json'), { authenticated: false, account: null, scopes: [] })
  assert.deepEqual(parseGhAuthJson(JSON.stringify({ hosts: {} })), { authenticated: false, account: null, scopes: [] })
})

test('login cannot start without an installed gh and cancel is harmless', () => {
  assert.equal(githubLoginStatus().state, 'idle')
  assert.equal(githubLoginStatus().active, false)
  assert.equal(cancelGithubLogin().canceled, false)
  assert.throws(() => beginGithubLogin(tempHome(), { platform: 'linux', envPath: '' }), /not installed/)
})

test('parseRepoList keeps owner/name rows and drops anything else', () => {
  const rows = parseRepoList(JSON.stringify([
    { nameWithOwner: 'Homer4033/dsh-compression-tiers', isPrivate: false, updatedAt: '2026-11-19T00:00:00Z', pushedAt: '2026-11-19T01:00:00Z' },
    { nameWithOwner: 'Homer4033/dsh-compression-tiers', isPrivate: true },
    { nameWithOwner: 'not-a-name' },
    { nameWithOwner: 'a/b/c' },
    { nameWithOwner: 'https://github.com/a/b' },
    { nameWithOwner: '  Homer4033/private-notes  ', isPrivate: true, updatedAt: 42 },
    { nameWithOwner: '' },
    null,
  ]))
  assert.deepEqual(rows, [
    {
      nameWithOwner: 'Homer4033/dsh-compression-tiers',
      private: false,
      updatedAt: '2026-11-19T00:00:00Z',
      pushedAt: '2026-11-19T01:00:00Z',
    },
    { nameWithOwner: 'Homer4033/private-notes', private: true, updatedAt: null, pushedAt: null },
  ])
  assert.deepEqual(parseRepoList('not json'), [])
  assert.deepEqual(parseRepoList('{"repos":[]}'), [])
  assert.deepEqual(parseRepoList(''), [])
})

test('listRepos reports a missing gh instead of an empty account', async () => {
  const home = tempHome()
  try {
    const listed = await listRepos(home, { platform: 'win32', envPath: '' })
    assert.deepEqual(listed, { ok: false, error: 'gh-not-installed', repos: [], detail: '' })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

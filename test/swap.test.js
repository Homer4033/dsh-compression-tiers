import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isCrossDeviceError, isLockedError, moveIntoPlace, renameWithRetry } from '../src/swap.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'ct-swap-'))
}

function lockedError(code = 'EPERM') {
  const error = new Error(`${code}: operation not permitted`)
  error.code = code
  return error
}

test('a free path is renamed on the first attempt', async () => {
  const root = tempDir()
  try {
    const from = join(root, 'staged-bin')
    const to = join(root, 'bin')
    mkdirSync(from)
    writeFileSync(join(from, 'ffmpeg.exe'), 'binary')
    const result = await moveIntoPlace(from, to)
    assert.equal(result.how, 'rename')
    assert.equal(readFileSync(join(to, 'ffmpeg.exe'), 'utf8'), 'binary')
    assert.equal(existsSync(from), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a lock on the tree is retried and then renamed', async () => {
  const root = tempDir()
  try {
    const from = join(root, 'staged-bin')
    const to = join(root, 'bin')
    mkdirSync(from)
    writeFileSync(join(from, 'ffmpeg.exe'), 'binary')
    let calls = 0
    const rename = (a, b) => {
      calls += 1
      if (calls < 3) throw lockedError('EPERM')
      renameSync(a, b)
    }
    const attempts = await renameWithRetry(from, to, { rename, delayMs: 0 })
    assert.equal(attempts, 3)
    assert.equal(calls, 3)
    assert.equal(readFileSync(join(to, 'ffmpeg.exe'), 'utf8'), 'binary')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a lock that outlives the retries falls back to a copy', async () => {
  const root = tempDir()
  try {
    const from = join(root, 'staged-bin')
    const to = join(root, 'bin')
    mkdirSync(from)
    writeFileSync(join(from, 'ffmpeg.exe'), 'scan me')
    let renames = 0
    const rename = () => {
      renames += 1
      throw lockedError('EBUSY')
    }
    const result = await moveIntoPlace(from, to, { rename, attempts: 3, delayMs: 0 })
    assert.equal(result.how, 'copy')
    assert.equal(renames, 3)
    // The copy is complete and the locked source is left for the caller to prune.
    assert.equal(readFileSync(join(to, 'ffmpeg.exe'), 'utf8'), 'scan me')
    assert.equal(existsSync(from), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a refusal that a retry cannot fix is thrown at once', async () => {
  const root = tempDir()
  try {
    const from = join(root, 'staged-bin')
    const to = join(root, 'bin')
    mkdirSync(from)
    let calls = 0
    const rename = () => {
      calls += 1
      throw lockedError('ENOENT')
    }
    await assert.rejects(
      moveIntoPlace(from, to, { rename, attempts: 5, delayMs: 0 }),
      /ENOENT/,
    )
    assert.equal(calls, 1)
    assert.equal(existsSync(to), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('another volume is copied without retrying the rename', async () => {
  const root = tempDir()
  try {
    const from = join(root, 'staged-bin')
    const to = join(root, 'bin')
    mkdirSync(from)
    writeFileSync(join(from, 'ffmpeg.exe'), 'x')
    let renames = 0
    let copies = 0
    const rename = () => {
      renames += 1
      throw lockedError('EXDEV')
    }
    const result = await moveIntoPlace(from, to, {
      rename,
      copy: (a, b) => {
        copies += 1
        mkdirSync(b)
        writeFileSync(join(b, 'ffmpeg.exe'), 'x')
      },
      attempts: 5,
      delayMs: 0,
    })
    assert.equal(result.how, 'copy')
    assert.equal(renames, 1)
    assert.equal(copies, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the error classifiers only claim their own families', () => {
  assert.equal(isLockedError(lockedError('EPERM')), true)
  assert.equal(isLockedError(lockedError('EBUSY')), true)
  assert.equal(isLockedError(lockedError('ENOTEMPTY')), true)
  assert.equal(isLockedError(lockedError('EXDEV')), false)
  assert.equal(isLockedError(null), false)
  assert.equal(isCrossDeviceError(lockedError('EXDEV')), true)
  assert.equal(isCrossDeviceError(lockedError('EPERM')), false)
})

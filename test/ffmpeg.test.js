import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  ffmpegBinDir,
  ffmpegSource,
  ffmpegStatus,
  parseToolVersion,
  prependFfmpegPath,
  resolveTool,
  systemTool,
} from '../src/ffmpeg.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'compression-tiers-ffmpeg-'))
}

/** A file at `path` that looks like a staged binary. */
function touch(path) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'binary')
  return path
}

/** Stand-in for `runCommand` that answers `-version` for either tool. */
function versionRun() {
  return async (command) => ({
    code: 0,
    stdout: `${command.includes('ffprobe') ? 'ffprobe' : 'ffmpeg'} version 7.1.1-full_build-www.gyan.dev\n`,
    stderr: '',
  })
}

test('the managed source is the floating Windows essentials archive', () => {
  const source = ffmpegSource('win32')
  assert.equal(source.url, 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip')
  assert.equal(source.file, 'ffmpeg-release-essentials.zip')
  assert.equal(source.kind, 'zip')
  assert.deepEqual(source.binaries, { ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe' })
  assert.equal(ffmpegSource('linux'), null)
})

test('parseToolVersion reads the version line of either tool', () => {
  assert.equal(parseToolVersion('ffmpeg version 7.1.1-full_build-www.gyan.dev Copyright'), '7.1.1-full_build-www.gyan.dev')
  assert.equal(parseToolVersion('ffprobe version 6.0-static\n'), '6.0-static')
  assert.equal(parseToolVersion('built with clang'), null)
  assert.equal(parseToolVersion(''), null)
  assert.equal(parseToolVersion(undefined), null)
})

test('systemTool looks on PATH without running anything', () => {
  const root = tempDir()
  try {
    const bin = join(root, 'bin')
    const ffmpeg = touch(join(bin, 'ffmpeg.exe'))
    assert.equal(systemTool('ffmpeg', 'win32', [join(root, 'missing'), bin, ''].join(';')), ffmpeg)
    assert.equal(systemTool('ffprobe', 'win32', bin), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a managed copy wins over the PATH copy', () => {
  const root = tempDir()
  const home = join(root, 'home')
  try {
    const pathBin = join(root, 'path-bin')
    const pathCopy = touch(join(pathBin, 'ffmpeg.exe'))
    assert.deepEqual(
      resolveTool(home, 'ffmpeg', { platform: 'win32', envPath: pathBin }),
      { path: pathCopy, managed: false },
    )
    const managed = touch(join(ffmpegBinDir(home), 'ffmpeg.exe'))
    assert.deepEqual(
      resolveTool(home, 'ffmpeg', { platform: 'win32', envPath: pathBin }),
      { path: managed, managed: true },
    )
    // No managed source for this platform and an empty PATH: nothing to find.
    assert.equal(resolveTool(home, 'ffmpeg', { platform: 'linux', envPath: '' }), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an untouched home reports both tools missing', async () => {
  const root = tempDir()
  try {
    const status = await ffmpegStatus(root, { platform: 'win32', arch: 'x64', envPath: '', run: versionRun() })
    assert.equal(status.supported, true)
    assert.equal(status.state, 'missing')
    assert.equal(status.ffmpeg, null)
    assert.equal(status.ffprobe, null)
    assert.equal(status.version, null)
    assert.equal(status.download.running, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a managed pair reports versions and the installed state', async () => {
  const root = tempDir()
  try {
    touch(join(ffmpegBinDir(root), 'ffmpeg.exe'))
    touch(join(ffmpegBinDir(root), 'ffprobe.exe'))
    const seen = []
    const run = async (command) => {
      seen.push(command)
      return versionRun()(command)
    }
    const status = await ffmpegStatus(root, { platform: 'win32', arch: 'x64', envPath: '', run })
    assert.equal(status.state, 'installed')
    assert.equal(status.version, '7.1.1-full_build-www.gyan.dev')
    assert.equal(status.ffmpeg.managed, true)
    assert.equal(status.ffmpeg.version, '7.1.1-full_build-www.gyan.dev')
    assert.equal(status.ffprobe.version, '7.1.1-full_build-www.gyan.dev')
    assert.equal(seen.length, 2, 'each binary is probed once')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('one binary alone is a partial install', async () => {
  const root = tempDir()
  try {
    touch(join(ffmpegBinDir(root), 'ffmpeg.exe'))
    const status = await ffmpegStatus(root, { platform: 'win32', arch: 'x64', envPath: '', run: versionRun() })
    assert.equal(status.state, 'partial')
    assert.equal(status.ffprobe, null)
    assert.equal(status.ffmpeg.version, '7.1.1-full_build-www.gyan.dev')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the managed directory goes first on PATH exactly once', () => {
  const root = tempDir()
  const saved = process.env.PATH
  try {
    assert.equal(prependFfmpegPath(root, 'win32'), false)
    touch(join(ffmpegBinDir(root), 'ffmpeg.exe'))
    touch(join(ffmpegBinDir(root), 'ffprobe.exe'))
    process.env.PATH = 'C:\\windows'
    assert.equal(prependFfmpegPath(root, 'win32'), true)
    assert.equal(process.env.PATH.split(';')[0], ffmpegBinDir(root))
    assert.equal(prependFfmpegPath(root, 'win32'), true)
    assert.equal(process.env.PATH.split(';').filter((dir) => dir === ffmpegBinDir(root)).length, 1)
    // A platform without a managed source is left alone.
    assert.equal(prependFfmpegPath(root, 'linux'), false)
  } finally {
    process.env.PATH = saved
    rmSync(root, { recursive: true, force: true })
  }
})

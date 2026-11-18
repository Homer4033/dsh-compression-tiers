import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSettings, settingsPaths, writeJson, writeSettings, writeText } from '../src/store.js'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'compression-tiers-'))
}

test('a missing settings file reports exists=false and the default tier', () => {
  const home = tempHome()
  try {
    const state = readSettings(home)
    assert.equal(state.exists, false)
    assert.equal(state.settings.level, 'standard')
    assert.deepEqual(state.settings.modelRoutes, [])
    assert.equal(state.paths.settings, join(home, 'compression-tiers', 'settings.json'))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('writes are normalized, persisted and read back', () => {
  const home = tempHome()
  try {
    const saved = writeSettings(home, {
      settings: {
        level: 'aggressive',
        modelRoutes: [{ provider: 'p', model: 'm', headroomTokens: 8192 }],
      },
    })
    assert.equal(saved.exists, true)
    assert.equal(saved.settings.level, 'aggressive')
    const again = readSettings(home)
    assert.deepEqual(again.settings.modelRoutes, [{ provider: 'p', model: 'm', headroomTokens: 8192 }])
    assert.equal(settingsPaths(home).settings, again.paths.settings)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('hand-edited values are tolerated', () => {
  const home = tempHome()
  try {
    writeSettings(home, { settings: { level: 'off', modelRoutes: 'bad line' } })
    const state = readSettings(home)
    assert.equal(state.settings.level, 'gentle')
    assert.deepEqual(state.settings.modelRoutes, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a corrupt JSON file falls back to defaults without throwing', () => {
  const home = tempHome()
  try {
    writeSettings(home, { settings: { level: 'max' } })
    writeFileSync(settingsPaths(home).settings, '{ broken')
    const state = readSettings(home)
    assert.equal(state.exists, false)
    assert.equal(state.settings.level, 'standard')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('atomic text writes create missing directories and leave no temp file', () => {
  const home = tempHome()
  try {
    const path = join(home, 'nested', 'AGENTS.md')
    writeText(path, 'first\n')
    writeText(path, 'second\n')
    assert.equal(readFileSync(path, 'utf8'), 'second\n')
    assert.deepEqual(readdirSync(join(home, 'nested')), ['AGENTS.md'])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('github settings keep the default repository and drop the retired repository list', () => {
  const home = tempHome()
  try {
    const empty = readSettings(home)
    assert.equal(empty.settings.github.repoPath, '')
    assert.equal(empty.settings.github.remote, 'origin')

    writeSettings(home, {
      settings: { github: { repoPath: ' D:/repo ', repos: ['D:/a', 'D:/b'] } },
    })
    const state = readSettings(home)
    assert.equal(state.settings.github.repoPath, 'D:/repo')
    assert.equal('repos' in state.settings.github, false)
    // The field is also gone from the file on disk, not only in memory.
    assert.equal(readFileSync(settingsPaths(home).settings, 'utf8').includes('"repos"'), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('writeJson is a thin atomic text write', () => {
  const home = tempHome()
  try {
    const path = join(home, 'state.json')
    writeJson(path, { level: 'max' })
    assert.equal(readFileSync(path, 'utf8'), '{\n  "level": "max"\n}\n')
    assert.deepEqual(readdirSync(home), ['state.json'])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { COMPACTION_PLUGIN, presetCompactionEntries, presetEnginePolicies, syncPresetCompaction } from '../src/presets.js'
import { COMPRESSION } from '../src/levels.js'

function fakeEntry(config, { name = COMPACTION_PLUGIN, disabled = false } = {}) {
  const entry = {
    options: { id: 'compaction-basic', name, config },
    disabled,
    updates: [],
    async update(patch) {
      entry.updates.push(patch)
      entry.options = { ...entry.options, ...patch }
    },
  }
  return entry
}

function fakePresets(entries) {
  return {
    definitions: {
      values: () => [{
        generation: {
          mount: {
            tree: { entries: () => entries },
          },
        },
      }],
    },
  }
}

test('only live compaction-basic rows are selected', () => {
  const live = fakeEntry({})
  const disabled = fakeEntry({}, { disabled: true })
  const other = fakeEntry({}, { name: '@deepseek-ai/dsh-other' })
  const entries = presetCompactionEntries(fakePresets([live, disabled, other]))
  assert.deepEqual(entries, [live])
  assert.deepEqual(presetCompactionEntries(null), [])
})

test('sync replaces the tier fields and preserves unknown ones', async () => {
  const entry = fakeEntry({ auto: true, thresholdRatio: 0.8, retainRatio: 0.16, futureDefault: 'keep' })
  const presets = fakePresets([entry])
  const result = await syncPresetCompaction(presets, COMPRESSION.standard, [])
  assert.deepEqual(result, { presets: 1, updated: 1 })
  assert.deepEqual(entry.options.config, {
    auto: true,
    thresholdRatio: 0.6,
    retainRatio: 0.16,
    futureDefault: 'keep',
  })
  const second = await syncPresetCompaction(presets, COMPRESSION.standard, [])
  assert.deepEqual(second, { presets: 1, updated: 0 })
})

test('route overrides replace and then clear modelPolicies', async () => {
  const entry = fakeEntry({ thresholdRatio: 0.6, retainRatio: 0.16, modelPolicies: [{ provider: 'old', model: 'x' }] })
  const presets = fakePresets([entry])
  await syncPresetCompaction(presets, COMPRESSION.max, [
    { provider: 'local', model: 'small', headroomTokens: 8192, retainTokens: 2048, extra: 'dropped' },
  ])
  assert.deepEqual(entry.options.config.modelPolicies, [
    { provider: 'local', model: 'small', headroomTokens: 8192, retainTokens: 2048 },
  ])
  assert.equal(entry.options.config.retainRatio, 0.06)
  await syncPresetCompaction(presets, COMPRESSION.max, [])
  assert.equal(entry.options.config.modelPolicies, undefined)
})

test('presetEnginePolicies reports the mounted policy', () => {
  const presets = fakePresets([fakeEntry({ auto: true, thresholdRatio: 0.5, retainRatio: 0.1 })])
  assert.deepEqual(presetEnginePolicies(presets), [{
    id: 'compaction-basic',
    auto: true,
    thresholdRatio: 0.5,
    retainRatio: 0.1,
    modelPolicies: 0,
  }])
})

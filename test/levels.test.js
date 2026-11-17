import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPRESSION,
  COMPRESSION_LEVELS,
  compactLevel,
  compressionSpec,
  distinctThresholds,
  effectiveCompaction,
  levelForPolicy,
  parseLevel,
  presetCompactionConfig,
} from '../src/levels.js'

test('the five tiers keep their order and policy', () => {
  assert.deepEqual(COMPRESSION_LEVELS, ['gentle', 'light', 'standard', 'aggressive', 'max'])
  const expected = {
    gentle: [0.8, 0.2],
    light: [0.7, 0.18],
    standard: [0.6, 0.16],
    aggressive: [0.5, 0.1],
    max: [0.4, 0.06],
  }
  for (const id of COMPRESSION_LEVELS) {
    const spec = COMPRESSION[id]
    assert.equal(spec.auto, true)
    assert.equal(spec.manual, true)
    assert.equal(spec.thresholdRatio, expected[id][0])
    assert.equal(spec.retainRatio, expected[id][1])
    assert.ok(spec.summary.length > 0)
  }
})

test('compactLevel tolerates the retired off id and unknown ids', () => {
  assert.equal(compactLevel('off'), 'gentle')
  assert.equal(compactLevel('max'), 'max')
  assert.equal(compactLevel('nonsense'), 'standard')
  assert.equal(compactLevel(undefined), 'standard')
})

test('parseLevel is strict', () => {
  assert.equal(parseLevel(' MAX '), 'max')
  assert.equal(parseLevel('off'), 'gentle')
  assert.throws(() => parseLevel('nonsense'), /Unknown compression level/)
  assert.throws(() => parseLevel(''), /Unknown compression level/)
})

test('compressionSpec rejects unknown tiers', () => {
  assert.equal(compressionSpec('light').thresholdRatio, 0.7)
  assert.throws(() => compressionSpec('unknown'), /Unknown compression level/)
})

test('effectiveCompaction follows the official headroom formula', () => {
  const window = 1048576
  assert.deepEqual(effectiveCompaction('standard', window), { thresholdTokens: 629145, retainTokens: 167772 })
  assert.deepEqual(effectiveCompaction('max', window), { thresholdTokens: 419430, retainTokens: 62914 })
  assert.deepEqual(effectiveCompaction('gentle', window), { thresholdTokens: 838860, retainTokens: 209715 })
  // An output reserve lowers both the trigger and the retain budget.
  const reserved = effectiveCompaction('standard', window, 16384)
  assert.equal(reserved.thresholdTokens, 629145)
  assert.equal(reserved.retainTokens, 165150)
})

test('a window that cannot fit the headroom has no valid budget', () => {
  assert.equal(effectiveCompaction('standard', 65536), null)
  assert.equal(effectiveCompaction('standard', 0), null)
  assert.equal(effectiveCompaction('standard', 'nope'), null)
})

test('the tiers collapse on short windows', () => {
  // A 16,384-token output reserve is what the five tiers are designed around.
  assert.equal(distinctThresholds(1048576, 16384), 5)
  assert.equal(distinctThresholds(262144, 16384), 4)
  assert.equal(distinctThresholds(131072, 16384), 1)
  assert.equal(distinctThresholds(65536, 16384), 0)
})

test('levelForPolicy maps a mounted policy back to a tier', () => {
  assert.equal(levelForPolicy({ thresholdRatio: 0.6, retainRatio: 0.16 }), 'standard')
  assert.equal(levelForPolicy({ thresholdRatio: 0.4, retainRatio: 0.06 }), 'max')
  assert.equal(levelForPolicy({ thresholdRatio: 0.6, retainTokens: 2048 }), null)
  assert.equal(levelForPolicy({ thresholdRatio: 0.55, retainRatio: 0.16 }), null)
  assert.equal(levelForPolicy(null), null)
})

test('presetCompactionConfig mirrors tier fields and route overrides', () => {
  assert.deepEqual(presetCompactionConfig(COMPRESSION.standard), {
    auto: true,
    thresholdRatio: 0.6,
    retainRatio: 0.16,
  })
  assert.deepEqual(presetCompactionConfig(COMPRESSION.max, [
    { provider: 'local', model: 'small-context', headroomTokens: 8192, retainTokens: 2048 },
  ]), {
    auto: true,
    thresholdRatio: 0.4,
    retainRatio: 0.06,
    modelPolicies: [
      { provider: 'local', model: 'small-context', headroomTokens: 8192, retainTokens: 2048 },
    ],
  })
})

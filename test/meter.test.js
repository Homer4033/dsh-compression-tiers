import test from 'node:test'
import assert from 'node:assert/strict'
import {
  attachContextMeter,
  compactionWindowNote,
  computeContextBudget,
  computeContextMeter,
  contextReportText,
  formatMeterLine,
  formatTokenCount,
  meterBucket,
  readContextWindow,
  readMeter,
} from '../src/context-meter.js'
import { COMPRESSION } from '../src/levels.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

test('computeContextBudget uses the official upper bound', () => {
  assert.deepEqual(computeContextBudget({ windowTokens: 1048576, thresholdRatio: 0.6, retainRatio: 0.16 }), {
    windowTokens: 1048576,
    thresholdTokens: 629145,
    retainTokens: 167772,
  })
  assert.equal(computeContextBudget({ windowTokens: 65536, thresholdRatio: 0.6, retainRatio: 0.16 }), null)
  assert.equal(computeContextBudget({ windowTokens: 0, thresholdRatio: 0.6, retainRatio: 0.16 }), null)
})

test('computeContextMeter folds occupancy into the numbers the model needs', () => {
  const meter = computeContextMeter({
    windowTokens: 1048576,
    usedTokens: 500000,
    spec: COMPRESSION.standard,
  })
  assert.equal(meter.usedTokens, 500000)
  assert.equal(meter.thresholdTokens, 629145)
  assert.equal(meter.retainTokens, 167772)
  assert.equal(meter.untilCompaction, 129145)
  assert.equal(meter.critical, false)
  assert.equal(meterBucket(meter), 7)
  assert.match(formatMeterLine(meter), /\[context\] 500,000 \/ 1,048,576 used \(47\.7%\), 129,145 tokens until automatic compaction/)
})

test('critical occupancy is announced', () => {
  const meter = computeContextMeter({
    windowTokens: 1048576,
    usedTokens: 625000,
    spec: COMPRESSION.standard,
  })
  assert.equal(meter.critical, true)
  const line = formatMeterLine(meter)
  assert.match(line, /^\[context alert\]/)
  assert.match(line, /compression_compact/)
})

test('formatTokenCount groups thousands and tolerates garbage', () => {
  assert.equal(formatTokenCount(1234567), '1,234,567')
  assert.equal(formatTokenCount(-5), '-5')
  assert.equal(formatTokenCount('nope'), '?')
})

test('a note explains collapsed or unusable windows', () => {
  assert.match(compactionWindowNote(131072, 16384), /only reach 1 distinct/)
  assert.match(compactionWindowNote(65536, 16384), /cannot fit/)
  assert.equal(compactionWindowNote(1048576, 16384), '')
  assert.equal(compactionWindowNote(0), '')
})

test('the report names this plugin tools', () => {
  const meter = computeContextMeter({ windowTokens: 1048576, usedTokens: 500000, spec: COMPRESSION.standard })
  const text = contextReportText(meter, COMPRESSION.standard)
  assert.match(text, /compression_compact/)
  assert.match(text, /629,145/)
})

test('readMeter prefers measure() and the routed window', () => {
  const meter = readMeter((name) => name === 'tokenMeter' ? {
    measure: () => ({ totalTokens: 500000 }),
    contextPressure: () => ({ pressureTokens: 1, contextWindow: 1048576 }),
  } : undefined, {
    requestContext: () => ({ contextWindow: 1048576 }),
  }, COMPRESSION.standard)
  assert.equal(meter.usedTokens, 500000)
  assert.equal(meter.windowTokens, 1048576)
})

test('readContextWindow reads the routed window', () => {
  assert.equal(readContextWindow(() => undefined, { requestContext: () => ({ contextWindow: 262144 }) }), 262144)
  assert.equal(readContextWindow(() => undefined, null), null)
})

test('the tail line is injected once per 10% band', async () => {
  let listener
  const ctx = {
    on(event, callback) {
      assert.equal(event, 'session/event')
      listener = callback
      return () => {}
    },
    effect(callback) {
      return callback()
    },
  }
  const agent = {
    status: 'running',
    injected: [],
    inject(payload) {
      this.injected.push(payload)
      return Promise.resolve()
    },
  }
  const session = { header: { id: 'session-1' }, requestContext: () => ({ contextWindow: 1048576 }) }
  attachContextMeter(ctx, {
    readService: (name) => {
      if (name === 'tokenMeter') return { measure: () => ({ totalTokens: 500000 }) }
      if (name === 'agents') return { get: () => ({ agent }) }
      return undefined
    },
    readPolicy: () => COMPRESSION.standard,
    trace: () => {},
  })
  listener(session, { type: 'turn/start', data: { turn: 1 } })
  await tick()
  assert.equal(agent.injected.length, 1)
  assert.match(agent.injected[0].content[0].text, /^\[context\]/)
  assert.equal(agent.injected[0].source.kind, 'compression-tiers-context')
  // Same band: no second line.
  listener(session, { type: 'assistant/message' })
  await tick()
  assert.equal(agent.injected.length, 1)
})

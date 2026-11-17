import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_MODEL_ROUTES, formatRouteLines, normalizeRoutes, parseRouteLines } from '../src/routes.js'

test('route lines carry provider, model, headroom and an optional retain', () => {
  const routes = parseRouteLines('local small-context 8192 2048\n# comment\n\nother model 4096')
  assert.deepEqual(routes, [
    { provider: 'local', model: 'small-context', headroomTokens: 8192, retainTokens: 2048 },
    { provider: 'other', model: 'model', headroomTokens: 4096 },
  ])
  assert.equal(formatRouteLines(routes), 'local small-context 8192 2048\nother model 4096')
})

test('malformed route lines are rejected', () => {
  assert.throws(() => parseRouteLines('only two'), /route line needs/)
  assert.throws(() => parseRouteLines('a b 0'), /headroomTokens/)
  assert.throws(() => parseRouteLines('a b 10 0x'), /retainTokens/)
  assert.throws(() => parseRouteLines('a b 10\na b 20'), /duplicate route/)
  assert.throws(() => parseRouteLines('bad provider! b 10'), /unsupported characters/)
  const tooMany = Array.from({ length: MAX_MODEL_ROUTES + 1 }, (_, index) => `p${index} m 100`).join('\n')
  assert.throws(() => parseRouteLines(tooMany), /at most/)
})

test('normalizeRoutes drops bad hand-edited data instead of throwing', () => {
  assert.deepEqual(normalizeRoutes('bad line'), [])
  assert.deepEqual(normalizeRoutes([{ provider: 'p', model: 'm', headroomTokens: 10 }]), [
    { provider: 'p', model: 'm', headroomTokens: 10 },
  ])
  assert.deepEqual(normalizeRoutes(null), [])
})

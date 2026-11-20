import test from 'node:test'
import assert from 'node:assert/strict'
import { attachCompactQueue, COMPACT_TOOL_NAME, resolveCompaction } from '../src/manual-compact.js'

/**
 * A context whose `session/event` subscription can be fired by hand, plus an
 * agent that resolves a fake compaction service and records follow-ups.
 */
function harness() {
  const listeners = []
  const events = []
  const calls = { compact: 0, followup: [] }
  let pending = null

  const service = {
    async compactNow() {
      calls.compact += 1
      if (pending) return pending.promise
      return { shadowedSeqs: [1, 2, 3], shadowedTokenCount: 1234 }
    },
  }
  const agent = {
    status: 'idle',
    ctx: { compaction: service },
    followup(message) {
      calls.followup.push(message)
    },
  }
  const session = { header: { id: 'session-a' } }
  const ctx = {
    get() {
      return undefined
    },
    on(name, listener) {
      if (name === 'session/event') listeners.push(listener)
      return () => {
        const at = listeners.indexOf(listener)
        if (at >= 0) listeners.splice(at, 1)
      }
    },
  }
  return {
    ctx,
    agent,
    session,
    calls,
    fire(event) {
      for (const listener of listeners) listener(session, event)
    },
    userSpeaks() {
      this.fire({ type: 'user/message', data: { source: { kind: 'user' } } })
    },
    turnEnds(reason = 'ok') {
      this.fire({ type: 'turn/end', data: { reason: { kind: reason } } })
    },
    controlCompaction() {
      let resolve
      const promise = new Promise((done) => { resolve = done })
      pending = { promise, resolve }
      return { resolve: (value) => { pending = null; resolve(value) } }
    },
  }
}

/** Wait until `check` is true; fails the test on timeout. */
async function waitFor(check, label) {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`timed out waiting for ${label}`)
}

test('a queued compaction runs after the turn and resumes the conversation', async () => {
  const h = harness()
  const { request } = attachCompactQueue(h.ctx, {})
  const queued = request(h.session, h.agent)
  assert.match(queued.text, /Compaction queued/)
  assert.equal(h.calls.compact, 0, 'nothing runs before the turn ends')

  h.turnEnds()
  await waitFor(() => h.calls.followup.length === 1, 'the resume follow-up')
  assert.equal(h.calls.compact, 1)
  assert.match(h.calls.followup[0].content[0].text, /Context compacted: 3 history entries/)
  assert.equal(h.calls.followup[0].source.kind, 'compression-tiers-context')
})

test('a second request is refused while one is queued', () => {
  const h = harness()
  const { request } = attachCompactQueue(h.ctx, {})
  request(h.session, h.agent)
  const again = request(h.session, h.agent)
  assert.match(again.text, /already requested/)
  assert.equal(h.calls.compact, 0)
})

test('an aborted turn drops the queued compaction', async () => {
  const h = harness()
  const { request } = attachCompactQueue(h.ctx, {})
  request(h.session, h.agent)
  h.turnEnds('aborted')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(h.calls.compact, 0)
  assert.equal(h.calls.followup.length, 0)
})

test('a user message that arrives before the turn ends cancels the compaction', async () => {
  const h = harness()
  const { request } = attachCompactQueue(h.ctx, {})
  request(h.session, h.agent)
  // The human typed while the model was still finishing its last message.
  h.userSpeaks()
  h.turnEnds()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(h.calls.compact, 0, 'the human took the turn; nothing compacts')
  assert.equal(h.calls.followup.length, 0, 'no "continue" message answers them out of order')
})

test('a user message during the compaction keeps it but skips the resume', async () => {
  const h = harness()
  const control = h.controlCompaction()
  const { request } = attachCompactQueue(h.ctx, {})
  request(h.session, h.agent)
  h.turnEnds()
  await waitFor(() => h.calls.compact === 1, 'the compaction to start')
  // The human asked something while the compaction was already running.
  h.userSpeaks()
  control.resolve({ shadowedSeqs: [1], shadowedTokenCount: 10 })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(h.calls.compact, 1, 'a running compaction is not stranded')
  assert.equal(h.calls.followup.length, 0, 'their own message becomes the next turn')
})

test('a host compaction is reported but not repeated, and the turn resumes', async () => {
  const h = harness()
  // The host engine takes the agent first: it compacts at the pressure
  // threshold while our job is waiting for an idle agent.
  h.agent.status = 'running'
  const { request } = attachCompactQueue(h.ctx, {})
  request(h.session, h.agent)
  h.turnEnds()
  await new Promise((resolve) => setTimeout(resolve, 20))
  h.fire({ type: 'compaction/start', data: {} })
  h.fire({ type: 'compaction/end', data: {} })
  h.agent.status = 'idle'
  await waitFor(() => h.calls.followup.length === 1, 'the resume follow-up')
  assert.equal(h.calls.compact, 0, 'the host already compacted; ours must not run')
  assert.match(h.calls.followup[0].content[0].text, /host just compacted automatically/)
})

test('the tool name and engine resolution stay stable', async () => {
  assert.equal(COMPACT_TOOL_NAME, 'compression_compact')
  const h = harness()
  assert.equal(resolveCompaction(h.agent, h.ctx), h.agent.ctx.compaction)
  // No service anywhere: the request explains itself instead of throwing.
  const bare = { ctx: {}, get: () => undefined, on: () => () => {} }
  const { request } = attachCompactQueue(bare, {})
  const answer = request({ header: { id: 'session-b' } }, { status: 'idle' })
  assert.match(answer.text, /no compaction service mounted/)
})

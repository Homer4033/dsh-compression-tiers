import { randomUUID } from 'node:crypto'

/**
 * Agent-driven compaction.
 *
 * The model asks for a compaction through `compression_compact`; the tool only
 * queues it. The engine resolved from the Agent's preset group then runs
 * `compactNow()`, which needs an idle agent (it runs through
 * `agent.runMaintenance()`), so the queue runs at `turn/end`, then sends a
 * follow-up so the conversation continues by itself instead of stopping on the
 * summary. This is the proactive path: it compacts even below the automatic
 * pressure threshold.
 */

export const COMPACT_TOOL_NAME = 'compression_compact'
/** Wait window between turn end and a genuinely idle agent. */
const BUSY_WAIT_MS = 120_000
const IDLE_POLL_MS = 50
/** Minimum gap between two model-requested compactions for one session. */
const DEDUPE_MS = 60_000
/** A queued request that never sees a normal turn end expires. */
const QUEUE_TTL_MS = 10 * 60_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function safeGet(ctx, name) {
  if (!ctx || typeof ctx.get !== 'function') return undefined
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

/** Accept a plain Agent or an agent handle that wraps one. */
function agentTarget(agent) {
  return agent && agent.agent ? agent.agent : agent
}

/**
 * Resolve the compaction engine that actually runs this Agent's history.
 *
 * The host plane mounts `compaction-basic` as `disabled` and keeps only the
 * token meter, so neither the plugin context nor `agent.ctx` sees an engine:
 * the live one is published inside the Agent preset's isolated group (the
 * preset rows carry `isolate: { compaction: true }`). `agentPresets.serviceFor`
 * is the official lookup for a service supplied by that group, so it comes
 * first; the plain context probes stay as a fallback for preset-free
 * compositions.
 */
export function resolveCompaction(agent, ctx) {
  const target = agentTarget(agent)
  const presets = safeGet(ctx, 'agentPresets')
  if (target && presets && typeof presets.serviceFor === 'function') {
    try {
      const service = presets.serviceFor(target, 'compaction')
      if (service && typeof service.compactNow === 'function') return service
    } catch {
      // Best effort: an unbound or retired preset generation just falls through.
    }
  }
  const scopes = []
  if (target && target.ctx) scopes.push(target.ctx)
  if (ctx) scopes.push(ctx)
  for (const scope of scopes) {
    let service
    // Direct property access is the reliable path inside a preset isolate;
    // a scope without the service throws from the inject proxy, so keep both
    // probes guarded.
    try {
      service = scope && scope.compaction
    } catch {
      service = undefined
    }
    if (!service) service = safeGet(scope, 'compaction')
    if (service && typeof service.compactNow === 'function') return service
  }
  return null
}

/**
 * Subscribe to `session/event` so queued compactions run after the turn.
 *
 * @param ctx - plugin context.
 * @param deps.trace - optional diagnostic logger.
 * @param deps.onFinished - called with `{ ok, result, error, skipped }` once a job settles.
 * @returns `{ request, dispose }`; `request(session, agent)` queues one compaction.
 */
export function attachCompactQueue(ctx, deps) {
  const trace = deps && typeof deps.trace === 'function' ? deps.trace : () => {}
  const onFinished = deps && typeof deps.onFinished === 'function' ? deps.onFinished : () => {}
  const jobs = new Map()
  const lastRequest = new Map()

  const finish = (payload) => {
    try {
      onFinished(payload)
    } catch (error) {
      trace('compact:finish-failed', error && error.message ? error.message : String(error))
    }
  }

  const request = (session, agent) => {
    const id = session && session.header && session.header.id ? session.header.id : ''
    if (!id) return { text: 'compression_compact is unavailable: this call has no session context.' }
    const existing = jobs.get(id)
    if (existing && Date.now() - existing.at < QUEUE_TTL_MS) {
      return { text: `A compaction was already requested (${existing.state === 'running' ? 'running' : 'queued'}); end this turn and wait for the automatic continuation.` }
    }
    if (existing) jobs.delete(id)
    const target = agentTarget(agent)
    const compaction = resolveCompaction(target, ctx)
    if (!compaction) {
      return {
        text: 'This session has no compaction service mounted (the engine runs inside the Agent preset scope, and the host exposes only the token meter), so it cannot be compacted on request. Use /compact instead, or check that compaction-basic is enabled for this preset in the plugin page.',
      }
    }
    const now = Date.now()
    const previous = lastRequest.get(id) || 0
    if (now - previous < DEDUPE_MS) {
      return { text: 'A compaction was requested moments ago; end this turn and wait for the automatic continuation.' }
    }
    lastRequest.set(id, now)
    jobs.set(id, { state: 'queued', agent: target, compaction, at: now, userSpoke: false, compacting: false, sawCompaction: false })
    trace('compact:queued', { sessionId: id })
    return {
      text: 'Compaction queued: it runs after this turn ends (even below the automatic threshold) and the conversation resumes automatically. End this turn now; do not call any more tools.',
    }
  }

  const listener = (session, event) => {
    try {
      const id = session && session.header ? session.header.id : ''
      if (!id || !event || !event.type) return
      const job = jobs.get(id)
      if (!job) return
      if (job.state === 'running' && event.type === 'compaction/start') {
        job.compacting = true
        return
      }
      if (job.state === 'running' && event.type === 'compaction/end') {
        job.compacting = false
        job.sawCompaction = true
        return
      }
      if (event.type === 'user/message') {
        if (job.state === 'running' && event.data && event.data.source && event.data.source.kind === 'user') {
          job.userSpoke = true
        }
        return
      }
      if (event.type !== 'turn/end' || job.state !== 'queued') return
      const reason = event.data && event.data.reason ? event.data.reason.kind : ''
      if (reason === 'aborted') {
        jobs.delete(id)
        trace('compact:aborted', { sessionId: id })
        return
      }
      job.state = 'running'
      setTimeout(() => { void runJob(session, id, job) }, 0)
    } catch (error) {
      trace('compact:event-failed', error && error.message ? error.message : String(error))
    }
  }

  async function runJob(session, id, job) {
    let text
    try {
      const outcome = await compactWhenIdle(job)
      if (outcome.skipped === 'user') {
        trace('compact:resume-skipped', { sessionId: id })
        jobs.delete(id)
        return
      }
      if (outcome.skipped === 'host') {
        // The host already compacted at the threshold: do not compact twice,
        // but still bring the conversation back to work.
        text = 'The host just compacted automatically. Continue the unfinished task; do not restate the plan and do not end with "next I will…".'
        trace('compact:host-compacted', { sessionId: id })
        finish({ ok: true, skipped: 'host' })
      } else if (outcome.result === null) {
        text = 'The requested compaction found no history to compact (the history is already short). Continue the current task.'
        trace('compact:nothing', { sessionId: id })
        finish({ ok: false, note: 'history already short' })
      } else {
        const count = Array.isArray(outcome.result.shadowedSeqs) ? outcome.result.shadowedSeqs.length : 0
        const tokens = Number.isFinite(outcome.result.shadowedTokenCount) ? outcome.result.shadowedTokenCount : 0
        text = `Context compacted: ${count} history entries became one summary, freeing about ${tokens} tokens. Continue the unfinished task; do not restate the plan and do not end with "next I will…".`
        trace('compact:done', { sessionId: id, tokens })
        finish({ ok: true, result: outcome.result, replaced: count, tokens })
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      if (job.compacting === true) {
        // `compaction/start` arrived without its `compaction/end`: the engine
        // may still be holding the session. Do not resume as if all is well;
        // say so instead of silently leaving the conversation blocked.
        text = `Compaction did not finish (${message}) and the service may still be busy: compaction/start arrived without compaction/end. Ask the user to run /compact, or restart the app before continuing, so the next compaction does not hang.`
        trace('compact:stuck', { sessionId: id, message })
        finish({ ok: false, skipped: 'compacting', error: message })
      } else if (isBusy(error) || /timed out waiting for idle/i.test(message)) {
        // Never drop the request without telling the model why it stopped.
        text = `Compaction did not run (${message}): the service is still busy or timed out waiting for idle. Continue the task; if the context is still tight, ask the user to run /compact or restart the app.`
        trace('compact:busy-skip', { sessionId: id, message })
        finish({ ok: false, skipped: 'busy', error: message })
      } else {
        text = `Compaction did not complete (${message}). Continue the task; if the context is still tight, ask the user to run /compact or switch tier.`
        trace('compact:failed', { sessionId: id, message })
        finish({ ok: false, error: message })
      }
    }
    if (!job.userSpoke) {
      try {
        job.agent.followup({
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'compression-tiers-context' },
        })
        trace('compact:resumed', { sessionId: id })
      } catch (error) {
        trace('compact:resume-failed', error && error.message ? error.message : String(error))
      }
    } else {
      trace('compact:resume-skipped', { sessionId: id })
    }
    jobs.delete(id)
  }

  return { request, dispose: ctx.on('session/event', listener) }
}

function isBusy(error) {
  if (!error) return false
  const cause = error.cause && error.cause.message ? String(error.cause.message) : ''
  return /already has active work/i.test(cause) || /already has active work/i.test(String(error.message || ''))
}

/**
 * Wait for a safe moment: the agent idle and no other compaction running.
 * - User speaks meanwhile: skip the compaction and the resume.
 * - Host compacted at the threshold meanwhile: skip ours but still resume.
 * - Otherwise call compactNow (null means there was little to compact).
 */
async function compactWhenIdle(job) {
  const deadline = Date.now() + BUSY_WAIT_MS
  while (Date.now() < deadline) {
    if (job.userSpoke) return { skipped: 'user' }
    if (job.compacting) {
      await sleep(IDLE_POLL_MS)
      continue
    }
    if (job.agent && job.agent.status === 'running') {
      await sleep(IDLE_POLL_MS)
      continue
    }
    if (job.sawCompaction) return { skipped: 'host' }
    try {
      const controller = new AbortController()
      const result = await job.compaction.compactNow(job.agent, controller.signal)
      return { result }
    } catch (error) {
      if (!isBusy(error)) throw (error && error.cause ? error.cause : error)
      await sleep(IDLE_POLL_MS)
    }
  }
  throw new Error('timed out waiting for idle')
}

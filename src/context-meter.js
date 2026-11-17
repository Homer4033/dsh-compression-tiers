import { randomUUID } from 'node:crypto'
import { COMPRESSION_LEVELS, LONG_WINDOW_TOKENS, distinctThresholds } from './levels.js'

/**
 * Context pressure helpers for agent-driven (proactive) compaction.
 *
 * The model owns the decision: it reads live occupancy here, saves what
 * matters, and queues `compression_compact` before the official automatic
 * threshold fires. Nothing in this module writes history; it only measures
 * and reports.
 */

/** Official dsh-compaction-basic default headroom. */
export const CONTEXT_HEADROOM_TOKENS = 65536
/** Below this share of the threshold the tail line turns into a warning. */
export const CRITICAL_HEADROOM_RATIO = 0.15
/** Message source kind for the tail occupancy line. */
export const METER_SOURCE_KIND = 'compression-tiers-context'

export function formatTokenCount(value) {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) return '?'
  const sign = number < 0 ? '-' : ''
  return sign + String(Math.abs(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Warn when the model window is too small for the five tiers to mean anything.
 * The official headroom (65,536) caps every ratio; below ~256k the tiers share
 * the same trigger, and at 65,536 or less the official budget is invalid.
 */
export function compactionWindowNote(windowTokens, outputReserveTokens = 0) {
  const window = Number(windowTokens)
  if (!Number.isFinite(window) || window <= 0) return ''
  const distinct = distinctThresholds(window, outputReserveTokens)
  if (distinct === 0) {
    return `This window (${formatTokenCount(window)} tokens) cannot fit the official 65,536-token headroom, so none of the five automatic tiers can fire. Use a larger window, or lower headroomTokens in a route policy.`
  }
  if (distinct < COMPRESSION_LEVELS.length) {
    return `At ${formatTokenCount(window)} tokens the five tiers only reach ${distinct} distinct automatic thresholds: the smaller the window, the more the 65,536-token reserve hides the tier difference, and the tiers mostly differ in retain size. The five tiers are designed for windows of at least ${formatTokenCount(LONG_WINDOW_TOKENS)} tokens.`
  }
  return ''
}

/**
 * Official threshold formula, without the request output reservation:
 * `floor(min(W × thresholdRatio, W − headroomTokens))`.
 * The output reservation only makes the official threshold smaller on routes
 * that reserve a large maxTokens, so this is an upper bound that stays useful.
 */
export function computeContextBudget({ windowTokens, thresholdRatio, retainRatio, headroomTokens = CONTEXT_HEADROOM_TOKENS }) {
  const window = Number(windowTokens)
  const ratio = Number(thresholdRatio)
  const retain = Number(retainRatio)
  const headroom = Number(headroomTokens)
  if (!Number.isFinite(window) || window <= 0) return null
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return null
  if (!Number.isFinite(retain) || retain < 0) return null
  const reserve = Number.isFinite(headroom) && headroom >= 0 ? headroom : CONTEXT_HEADROOM_TOKENS
  const thresholdTokens = Math.floor(Math.min(window * ratio, window - reserve))
  if (!Number.isFinite(thresholdTokens) || thresholdTokens <= 0) return null
  return {
    windowTokens: window,
    thresholdTokens,
    retainTokens: Math.floor(window * retain),
  }
}

/**
 * Fold a raw occupancy reading into the numbers the model needs.
 * `usedTokens` is the token-meter's current request pressure.
 */
export function computeContextMeter({ windowTokens, usedTokens, spec, headroomTokens }) {
  const budget = computeContextBudget({
    windowTokens,
    thresholdRatio: spec && spec.thresholdRatio,
    retainRatio: spec && spec.retainRatio,
    headroomTokens,
  })
  const used = Number(usedTokens)
  if (!budget) return null
  if (!Number.isFinite(used) || used < 0) return null
  const untilCompaction = Math.max(0, budget.thresholdTokens - used)
  return {
    windowTokens: budget.windowTokens,
    usedTokens: Math.round(used),
    thresholdTokens: budget.thresholdTokens,
    retainTokens: budget.retainTokens,
    untilCompaction,
    percent: used / budget.windowTokens,
    thresholdPercent: used / budget.thresholdTokens,
    critical: untilCompaction <= budget.thresholdTokens * CRITICAL_HEADROOM_RATIO,
  }
}

/** 0–9 bands of threshold usage; a new band is worth one more tail line. */
export function meterBucket(meter) {
  if (!meter || !Number.isFinite(meter.thresholdPercent)) return 0
  return Math.min(9, Math.max(0, Math.floor(meter.thresholdPercent * 10)))
}

export function formatMeterLine(meter) {
  if (!meter) return ''
  const used = formatTokenCount(meter.usedTokens)
  const window = formatTokenCount(meter.windowTokens)
  const percent = (meter.percent * 100).toFixed(1)
  const head = meter.critical ? '[context alert]' : '[context]'
  const tail = meter.critical
    ? 'Compaction is near: call compression_compact now (it runs after this turn and resumes automatically), or save the key conclusions first.'
    : 'Compaction rewrites history, so save anything important as you go.'
  return `${head} ${used} / ${window} used (${percent}%), ${formatTokenCount(meter.untilCompaction)} tokens until automatic compaction. ${tail}`
}

/** Human/model readable detail for the compression_context tool. */
export function contextReportText(meter, spec) {
  const level = spec && spec.label ? `${spec.label} (${spec.thresholdRatio})` : 'current tier'
  const note = compactionWindowNote(meter.windowTokens)
  return [
    formatMeterLine(meter),
    `Automatic threshold ${formatTokenCount(meter.thresholdTokens)} tokens (${level}); about ${formatTokenCount(meter.retainTokens)} tokens of recent history stay verbatim after compaction.`,
    `Current occupancy is ${(meter.thresholdPercent * 100).toFixed(1)}% of that threshold. To compact proactively call compression_compact; it runs after this turn and continues automatically.`,
    ...(note ? [note] : []),
  ].join('\n')
}

/**
 * Read just the model window, even when the pressure budget is invalid (small
 * window). Used to explain a missing meter instead of returning silence.
 */
export function readContextWindow(readService, session) {
  if (!session) return null
  let windowTokens
  // The session request context is the official routed capacity; the pressure
  // projection only remembers the newest `request/context` sample, so it is
  // the fallback rather than the primary source.
  try {
    if (typeof session.requestContext === 'function') {
      const context = session.requestContext()
      windowTokens = context && context.contextWindow
    }
  } catch {
    windowTokens = undefined
  }
  if (!Number.isFinite(windowTokens)) {
    const meter = readService('tokenMeter')
    try {
      if (meter && typeof meter.contextPressure === 'function') {
        const pressure = meter.contextPressure(session)
        windowTokens = pressure && pressure.contextWindow
      }
    } catch {
      windowTokens = undefined
    }
  }
  return Number.isFinite(windowTokens) && windowTokens > 0 ? windowTokens : null
}

/**
 * Read the live occupancy for one session from the official token meter.
 * Returns `null` when the host exposes neither a pressure projection nor a measure.
 */
export function readMeter(readService, session, spec, headroomTokens) {
  if (!session) return null
  const meter = readService('tokenMeter')
  if (!meter) return null
  let usedTokens
  let windowTokens
  // `measure()` prices the current session surface and is what the host uses
  // for its own usage reporting. `pressureTokens` is prompt-side only and
  // holds still while a turn streams, so it is the fallback.
  try {
    if (typeof meter.measure === 'function') {
      const measure = meter.measure(session)
      usedTokens = measure && measure.totalTokens
    }
  } catch {
    usedTokens = undefined
  }
  if (!Number.isFinite(usedTokens)) {
    try {
      if (typeof meter.contextPressure === 'function') {
        const pressure = meter.contextPressure(session)
        usedTokens = pressure && pressure.pressureTokens
      }
    } catch {
      usedTokens = undefined
    }
  }
  // Window: prefer the routed request context, then the pressure projection.
  try {
    if (typeof session.requestContext === 'function') {
      const context = session.requestContext()
      windowTokens = context && context.contextWindow
    }
  } catch {
    windowTokens = undefined
  }
  if (!Number.isFinite(windowTokens)) {
    try {
      if (meter && typeof meter.contextPressure === 'function') {
        const pressure = meter.contextPressure(session)
        windowTokens = pressure && pressure.contextWindow
      }
    } catch {
      windowTokens = undefined
    }
  }
  return computeContextMeter({ windowTokens, usedTokens, spec, headroomTokens })
}

function agentOf(readService, sessionId) {
  const agents = readService('agents')
  if (!agents || typeof agents.get !== 'function') return null
  try {
    const handle = agents.get(sessionId)
    const agent = handle && handle.agent ? handle.agent : handle
    return agent || null
  } catch {
    return null
  }
}

/**
 * Append the occupancy line to the conversation tail at turn boundaries and
 * whenever occupancy crosses another 10% of the automatic threshold.
 * It appends a user-context message, so the system prompt and its cache stay put.
 *
 * @param ctx - plugin context; listens to `session/event`.
 * @param deps.readService - resolve a host service by name.
 * @param deps.readPolicy - current `{ thresholdRatio, retainRatio }` level policy.
 * @param deps.trace - optional diagnostic logger.
 * @param deps.enabled - optional thunk; when it returns false nothing is injected.
 */
export function attachContextMeter(ctx, deps) {
  const trace = deps && typeof deps.trace === 'function' ? deps.trace : () => {}
  const readService = deps && deps.readService
  const readPolicy = deps && deps.readPolicy
  const enabled = deps && typeof deps.enabled === 'function' ? deps.enabled : () => true
  const state = new Map()

  const listener = (session, event) => {
    try {
      if (!enabled()) return
      const id = session && session.header ? session.header.id : ''
      if (!id || !event || !event.type) return
      const entry = state.get(id) || { bucket: -1, compactions: 0, lastTurn: -1, pending: false }
      state.set(id, entry)
      if (event.type === 'compaction/end') {
        entry.compactions += 1
        entry.bucket = -1
        return
      }
      if (event.type !== 'turn/start' && event.type !== 'assistant/message') return
      const policy = typeof readPolicy === 'function' ? readPolicy() : null
      const meter = readMeter(readService, session, policy)
      if (!meter) return
      const bucket = meterBucket(meter)
      const isTurnStart = event.type === 'turn/start'
      if (!isTurnStart && !(bucket > entry.bucket)) return
      if (isTurnStart && event.data && event.data.turn === entry.lastTurn) return
      // Only one injection may be in flight; its success advances the bucket.
      if (entry.pending) return
      const previousBucket = entry.bucket
      const previousTurn = entry.lastTurn
      const turn = isTurnStart && event.data ? event.data.turn : null
      const text = formatMeterLine(meter)
      // The reading predates any compaction that may start while we wait.
      // If one finished in the meantime, drop this stale line and let the next
      // step report fresh numbers instead of pasting "0 tokens left" onto a
      // freshly compacted history.
      const epoch = entry.compactions
      entry.pending = true
      setTimeout(() => {
        try {
          const current = state.get(id)
          if (!current || current.compactions !== epoch) {
            if (current) current.pending = false
            trace('meter:stale-skip', { used: meter.usedTokens })
            return
          }
          const agent = agentOf(readService, id)
          if (!agent || typeof agent.inject !== 'function' || (typeof agent.status === 'string' && agent.status !== 'running')) {
            // The agent is unavailable in this step. Do not consume the band:
            // a later event retries it instead of losing that 10% forever.
            current.pending = false
            trace('meter:inject-skipped', { bucket, used: meter.usedTokens })
            return
          }
          const result = agent.inject({
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text }],
            source: { kind: METER_SOURCE_KIND },
          })
          current.bucket = Math.max(current.bucket, bucket)
          if (turn !== null) current.lastTurn = turn
          current.pending = false
          if (result && typeof result.catch === 'function') {
            result.catch((error) => {
              // A rejected injection did not append the line: give the band
              // back when nothing newer was recorded in the meantime.
              const latest = state.get(id)
              if (latest && latest.compactions === epoch && latest.bucket === bucket) {
                latest.bucket = previousBucket
                latest.lastTurn = previousTurn
              }
              trace('meter:inject-failed', error && error.message ? error.message : String(error))
            })
          }
          trace('meter:injected', { bucket, used: meter.usedTokens, threshold: meter.thresholdTokens })
        } catch (error) {
          const current = state.get(id)
          if (current) current.pending = false
          trace('meter:inject-failed', error && error.message ? error.message : String(error))
        }
      }, 0)
    } catch (error) {
      trace('meter:failed', error && error.message ? error.message : String(error))
    }
  }

  return ctx.effect(() => ctx.on('session/event', listener), 'compression-tiers: context meter')
}

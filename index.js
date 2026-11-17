import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { COMPRESSION_LEVELS, compressionSpec, levelForPolicy, parseLevel } from './src/levels.js'
import { presetCompactionEntries, presetEnginePolicies, syncPresetCompaction } from './src/presets.js'
import { attachContextMeter, compactionWindowNote, contextReportText, readContextWindow, readMeter } from './src/context-meter.js'
import { attachCompactQueue, COMPACT_TOOL_NAME, resolveCompaction } from './src/manual-compact.js'
import { readSettings, writeSettings } from './src/store.js'
import { formatRouteLines, parseRouteLines } from './src/routes.js'
import { errorStatus, guard, readBody, sendJson } from './src/http.js'

export const name = 'homerdsh-compression-tiers'
export const inject = ['tools', 'systemPrompt']

function safeGet(ctx, key) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(key) : undefined
  } catch {
    return undefined
  }
}

function homeDir() {
  return resolveDshHome()
}

function trace(stage, detail) {
  // Keep the console quiet: only failures, skipped work and adoption matter.
  if (!/failed|error|skip|stale|adopt/i.test(stage)) return
  console.error('[compression-tiers]', stage, detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail))
}

/** Current stored tier policy; falls back to the plugin default before seeding. */
function readPolicy() {
  return compressionSpec(readSettings(homeDir()).settings.level)
}

/**
 * First run adopts whatever policy the mounted engines already use when it
 * matches a tier, so a matching install does not change the effective tier.
 * A policy outside the five tiers falls back to `standard`. Returns `null`
 * while no preset engine is mounted yet; the reconciler retries.
 */
function ensuredState(ctx) {
  const state = readSettings(homeDir())
  if (state.exists) return state
  const entries = presetCompactionEntries(safeGet(ctx, 'agentPresets'))
  if (entries.length === 0) return null
  let adopted = 'standard'
  for (const entry of entries) {
    const config = entry.options && entry.options.config
    const level = levelForPolicy(config)
    if (level) {
      adopted = level
      break
    }
  }
  const saved = writeSettings(homeDir(), { settings: { level: adopted } })
  console.error(`[compression-tiers] first run: adopted "${adopted}" from the mounted compaction policy`)
  return saved
}

async function reconcileOnce(ctx) {
  const state = ensuredState(ctx)
  if (!state) return null
  const service = safeGet(ctx, 'agentPresets')
  return syncPresetCompaction(service, compressionSpec(state.settings.level), state.settings.modelRoutes)
}

/**
 * Apply a tier immediately: persist it, then push it into every mounted preset
 * engine. The periodic reconciler catches presets mounted after activation.
 */
async function applyLevel(ctx, level, routes) {
  const spec = compressionSpec(level)
  const saved = writeSettings(homeDir(), {
    settings: {
      level,
      ...(routes === undefined ? {} : { modelRoutes: routes }),
    },
  })
  const result = await syncPresetCompaction(safeGet(ctx, 'agentPresets'), spec, saved.settings.modelRoutes)
  return { saved, spec, result }
}

function enginePolicy(agent, ctx) {
  const engine = resolveCompaction(agent, ctx)
  const config = engine && engine.config
  if (!config) return null
  return {
    auto: config.auto !== false,
    thresholdRatio: config.thresholdRatio,
    ...(config.retainTokens === undefined ? { retainRatio: config.retainRatio } : { retainTokens: config.retainTokens }),
    modelPolicies: Array.isArray(config.modelPolicies) ? config.modelPolicies.length : 0,
  }
}

function engineSummary(ctx) {
  const presets = safeGet(ctx, 'agentPresets')
  return {
    engines: presetCompactionEntries(presets).length,
    engineConfigs: presetEnginePolicies(presets),
  }
}

function recordCompact(payload) {
  const at = new Date().toISOString()
  if (payload.ok && payload.result) {
    writeSettings(homeDir(), {
      settings: {
        lastCompact: { at, compacted: true, replaced: payload.replaced ?? null, tokensSaved: payload.tokens ?? null },
      },
    })
    return
  }
  if (payload.ok && payload.skipped === 'host') {
    writeSettings(homeDir(), { settings: { lastCompact: { at, compacted: true, by: 'automatic' } } })
    return
  }
  const detail = payload.error ? { error: payload.error } : { note: payload.note || payload.skipped || 'not compacted' }
  writeSettings(homeDir(), { settings: { lastCompact: { at, compacted: false, ...detail } } })
}

function promptText(home) {
  const state = readSettings(home)
  const spec = compressionSpec(state.settings.level)
  return [
    'Context compression tiers.',
    `Current tier: ${state.settings.level}. Automatic pressure compaction fires at about ${Math.round(spec.thresholdRatio * 100)}% of the model window, and about ${Math.round(spec.retainRatio * 100)}% of recent history stays verbatim after it. Every tier keeps automatic compaction on. The five tiers are designed for long windows (>= 256k tokens); below that the official 65,536-token headroom caps the trigger and the tiers mostly differ in retain size.`,
    'Proactive compaction is the agent\'s call. The [context] line at the tail reports live occupancy; call compression_context for the same numbers on demand. When the remaining room is short or you still expect to read a lot more, first write the conclusions you must keep to disk, then call compression_compact once and end the turn. It runs after the turn ends and the conversation resumes automatically with the summary. Do not wait for automatic pressure compaction; /compact remains available to the human. compression_tiers reads or changes the tier, and accepts optional per-route overrides as "provider model headroomTokens [retainTokens]" lines.',
  ].join('\n\n')
}

function toolOutput() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: value && value.text ? value.text : JSON.stringify(value, null, 2) }],
  }
}

function statePayload(ctx) {
  const state = readSettings(homeDir())
  return {
    level: state.settings.level,
    levels: COMPRESSION_LEVELS.map((id) => ({ id, ...compressionSpec(id) })),
    modelRoutes: state.settings.modelRoutes,
    routeLines: formatRouteLines(state.settings.modelRoutes),
    lastCompact: state.settings.lastCompact,
    paths: { settings: state.paths.settings },
    ...engineSummary(ctx),
  }
}

export function apply(ctx) {
  const compactQueue = attachCompactQueue(ctx, { trace, onFinished: recordCompact })
  ctx.effect(() => compactQueue.dispose, 'compression-tiers: compact queue')
  attachContextMeter(ctx, {
    readService: (serviceName) => safeGet(ctx, serviceName),
    readPolicy,
    trace,
  })

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'compression-tiers',
    order: 245,
    interpolate: false,
    text: () => promptText(homeDir()),
  }), 'compression-tiers: prompt')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: COMPACT_TOOL_NAME,
    description: 'Queue a proactive compaction of this session\'s history. Call compression_context first; when the remaining room is short, save important conclusions to disk, then call this once and end the turn immediately without calling more tools. The compaction runs right after the turn ends (even below the automatic threshold) and this conversation resumes automatically with the summary.',
    parameters: {},
    output: toolOutput(),
    async execute(_args, exec) {
      const agent = exec.agent
      const session = agent && agent.session
      return compactQueue.request(session, agent)
    },
  })), 'compression-tiers: compact tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'compression_context',
    description: 'Read this session\'s live context occupancy: tokens used against the model window, this tier\'s automatic compaction threshold, and how much room is left before history is rewritten. Read-only, no side effects. Call it before reading more large files or when the [context] tail line says the threshold is near.',
    parameters: {},
    output: toolOutput(),
    async execute(_args, exec) {
      const agent = exec.agent
      const session = agent && agent.session
      const spec = readPolicy()
      const meter = readMeter((serviceName) => safeGet(ctx, serviceName), session, spec)
      if (!meter) {
        const windowTokens = readContextWindow((serviceName) => safeGet(ctx, serviceName), session)
        const windowNote = windowTokens ? compactionWindowNote(windowTokens) : ''
        return {
          ok: false,
          level: readSettings(homeDir()).settings.level,
          windowTokens,
          windowNote,
          text: windowNote
            ? `compression_context could not read a measurement. ${windowNote}`
            : 'compression_context is unavailable: the token meter returned no measurement.',
        }
      }
      const windowNote = compactionWindowNote(meter.windowTokens)
      const level = readSettings(homeDir()).settings.level
      return {
        ok: true,
        level,
        text: contextReportText(meter, spec, level),
        windowNote,
        windowTokens: meter.windowTokens,
        usedTokens: meter.usedTokens,
        thresholdTokens: meter.thresholdTokens,
        retainTokens: meter.retainTokens,
        untilCompaction: meter.untilCompaction,
        percent: Number((meter.percent * 100).toFixed(2)),
        thresholdPercent: Number((meter.thresholdPercent * 100).toFixed(2)),
      }
    },
  })), 'compression-tiers: context tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'compression_tiers',
    description: 'Read or set the five-tier context compression policy: gentle, light, standard, aggressive, or max. Every tier keeps automatic pressure compaction on; proactive compaction is agent-driven through compression_context plus compression_compact, while /compact stays available to the human. Setting a tier updates every mounted agent preset compaction engine immediately, and optional route overrides pass headroomTokens (and an optional absolute retainTokens) for an exact provider/model pair.',
    parameters: {
      level: { type: 'string', description: `One of ${COMPRESSION_LEVELS.join(', ')}. Omit to read the current tier.` },
      routeLines: {
        type: 'string',
        description: 'Optional per-route overrides, one "provider model headroomTokens [retainTokens]" per line. Pass an empty string to clear them.',
      },
    },
    output: toolOutput(),
    async execute(args, exec) {
      const session = exec && exec.agent ? exec.agent.session : undefined
      const windowTokens = session ? readContextWindow((serviceName) => safeGet(ctx, serviceName), session) : null
      const windowNote = windowTokens ? compactionWindowNote(windowTokens) : ''
      const setting = args.level !== undefined && args.level !== null && String(args.level).trim() !== ''
      const routesGiven = typeof args.routeLines === 'string'
      if (setting || routesGiven) {
        let level
        try {
          level = setting ? parseLevel(args.level) : readSettings(homeDir()).settings.level
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error) }
        }
        let routes
        try {
          routes = routesGiven ? parseRouteLines(args.routeLines) : readSettings(homeDir()).settings.modelRoutes
        } catch (error) {
          return { ok: false, text: `route overrides rejected: ${error instanceof Error ? error.message : String(error)}` }
        }
        try {
          const applied = await applyLevel(ctx, level, routes)
          return {
            ok: true,
            level,
            ...applied.spec,
            updatedEngines: applied.result.updated,
            ...engineSummary(ctx),
            windowTokens,
            windowNote,
            routeLines: formatRouteLines(routes),
            currentEngine: enginePolicy(exec.agent, ctx),
          }
        } catch (error) {
          return { ok: false, text: `could not update the compaction engines: ${error instanceof Error ? error.message : String(error)}` }
        }
      }
      const payload = statePayload(ctx)
      return { ok: true, ...payload, windowTokens, windowNote, currentEngine: enginePolicy(exec.agent, ctx), choices: COMPRESSION_LEVELS }
    },
  })), 'compression-tiers: tiers tool')

  ctx.inject(['webServer', 'connection'], (child) => {
    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: '/compression-tiers/api/settings',
      handler: async (req, res) => {
        if (guard(child, req, res)) return
        try {
          if (req.method === 'GET') {
            sendJson(res, 200, statePayload(ctx))
            return
          }
          if (req.method === 'POST') {
            const body = await readBody(req)
            const levelGiven = body.level !== undefined && body.level !== null && String(body.level).trim() !== ''
            const routesGiven = typeof body.routeLines === 'string'
            if (!levelGiven && !routesGiven) {
              sendJson(res, 400, { error: 'nothing to update: pass level and/or routeLines' })
              return
            }
            let level
            try {
              level = levelGiven ? parseLevel(body.level) : readSettings(homeDir()).settings.level
            } catch (error) {
              sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
              return
            }
            const routes = routesGiven
              ? parseRouteLines(body.routeLines)
              : readSettings(homeDir()).settings.modelRoutes
            const applied = await applyLevel(ctx, level, routes)
            sendJson(res, 200, {
              ...statePayload(ctx),
              updatedEngines: applied.result.updated,
            })
            return
          }
          sendJson(res, 405, { error: 'GET or POST' })
        } catch (error) {
          sendJson(res, errorStatus(error), { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }))
  })

  // Presets mount after this plugin in the official composition and live in
  // isolated groups. Retry quickly at first, then reconcile once a minute so a
  // session that mounts a preset later still gets the selected tier.
  ctx.effect(() => {
    let stopped = false
    let timer = null
    let chain = Promise.resolve()
    let attempts = 0
    const tick = () => {
      chain = chain
        .then(() => reconcileOnce(ctx))
        .then((result) => {
          if (result && result.updated > 0) {
            trace('reconcile:updated', { updated: result.updated, presets: result.presets })
          }
        })
        .catch((error) => {
          trace('reconcile:failed', error instanceof Error ? error.message : String(error))
        })
      return chain
    }
    const schedule = (delay) => {
      if (stopped) return
      timer = setTimeout(async () => {
        timer = null
        attempts += 1
        await tick()
        schedule(attempts < 40 ? 500 : 60_000)
      }, delay)
      timer.unref?.()
    }
    schedule(600)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
    }
  }, 'compression-tiers: engine reconciler')
}

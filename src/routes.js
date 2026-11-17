/**
 * Optional per-route compaction overrides. The official plugin matches exact
 * provider/model pairs, so users list them explicitly; this plugin never
 * guesses a route.
 *
 * Line format: `provider model headroomTokens [retainTokens]`.
 */

export const MAX_MODEL_ROUTES = 16
const SAFE_TOKEN = /^[A-Za-z0-9._:@/-]+$/

function positiveInt(value, name, { zero = false } = {}) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < (zero ? 0 : 1)) {
    throw new Error(`${name} must be an integer ${zero ? '>= 0' : '> 0'}`)
  }
  return number
}

export function parseRouteLines(text) {
  const routes = []
  const seen = new Set()
  const lines = String(text === undefined || text === null ? '' : text).split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    if (parts.length < 3 || parts.length > 4) {
      throw new Error(`route line needs "provider model headroom [retain]": ${line}`)
    }
    const provider = parts[0]
    const model = parts[1]
    if (!SAFE_TOKEN.test(provider) || !SAFE_TOKEN.test(model)) {
      throw new Error(`route provider/model contains unsupported characters: ${line}`)
    }
    const headroomTokens = positiveInt(parts[2], `headroomTokens (${line})`)
    const retainTokens = parts.length === 4 ? positiveInt(parts[3], `retainTokens (${line})`, { zero: true }) : undefined
    const key = `${provider}/${model}`
    if (seen.has(key)) throw new Error(`duplicate route: ${key}`)
    seen.add(key)
    routes.push({
      provider,
      model,
      headroomTokens,
      ...(retainTokens === undefined ? {} : { retainTokens }),
    })
  }
  if (routes.length > MAX_MODEL_ROUTES) {
    throw new Error(`at most ${MAX_MODEL_ROUTES} routes`)
  }
  return routes
}

export function formatRouteLines(routes) {
  if (!Array.isArray(routes)) return ''
  return routes
    .map((route) => {
      const parts = [route.provider, route.model, route.headroomTokens]
      if (route.retainTokens !== undefined) parts.push(route.retainTokens)
      return parts.join(' ')
    })
    .join('\n')
}

/** Tolerate a hand-edited settings.json: bad route data is dropped, not fatal. */
export function normalizeRoutes(value) {
  try {
    if (Array.isArray(value)) return parseRouteLines(formatRouteLines(value))
    if (typeof value === 'string') return parseRouteLines(value)
  } catch {
    return []
  }
  return []
}

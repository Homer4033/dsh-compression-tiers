/**
 * Small HTTP helpers for the settings route. The route is same-origin only and
 * authenticated through the official `connection` service; when that service
 * is unavailable the route fails closed.
 */

export const MAX_BODY_BYTES = 1024 * 1024
/** Log the fail-closed warning once instead of on every rejected request. */
let guardErrorLogged = false

export function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

export function errorStatus(error, fallback = 400) {
  const status = error && typeof error === 'object' ? Number(error.status) : NaN
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback
}

/**
 * A POST with a JSON body must declare `application/json`. Body-less button
 * POSTs (for example "refresh") carry no content type and stay allowed.
 */
export function requireJson(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase()
  const hasBody = req.headers['transfer-encoding'] !== undefined
    || (req.headers['content-length'] !== undefined && Number(req.headers['content-length']) > 0)
  if (type.startsWith('application/json')) return
  if (hasBody || type) throw httpError(415, 'request body must be application/json')
}

export function sendJson(res, status, body) {
  // Never write headers twice: once they are out, drop the connection instead
  // of letting the route throw.
  if (res.headersSent) {
    try {
      res.destroy()
    } catch {
      // ignore
    }
    return
  }
  const payload = JSON.stringify(body)
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    })
    res.end(payload)
  } catch {
    try {
      res.destroy()
    } catch {
      // ignore
    }
  }
}

export async function readBody(req, limit = MAX_BODY_BYTES) {
  requireJson(req)
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw httpError(413, 'request body is too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw httpError(400, 'request body is not valid JSON')
  }
}

/**
 * Entry gate for `/compression-tiers/*`: ask the official connection service
 * for a rejection (Host/Origin validation plus browser authentication). When
 * the gate cannot be consulted, fail closed rather than expose settings to any
 * local HTTP caller.
 */
export function guard(ctx, req, res, log = console.error) {
  const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
  if (!connection || typeof connection.requestRejection !== 'function') {
    if (!guardErrorLogged) {
      guardErrorLogged = true
      log('[compression-tiers] connection.requestRejection is unavailable; rejecting /compression-tiers/* requests')
    }
    sendJson(res, 503, { error: 'security check is unavailable; request rejected' })
    return true
  }
  let rejection
  try {
    rejection = connection.requestRejection(req)
  } catch (error) {
    if (!guardErrorLogged) {
      guardErrorLogged = true
      log('[compression-tiers] connection.requestRejection failed; rejecting /compression-tiers/* requests:', error instanceof Error ? error.message : String(error))
    }
    sendJson(res, 503, { error: 'security check is unavailable; request rejected' })
    return true
  }
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

/**
 * The five compression tiers, mapped onto the official `dsh-compaction-basic`
 * fields `thresholdRatio` (when automatic pressure compaction fires) and
 * `retainRatio` (how much recent history stays verbatim).
 *
 * Every tier keeps automatic pressure compaction on. `gentle` is the most
 * expensive tier and the only one that matches the official default; the
 * plugin default is `standard`, so long conversations compact earlier.
 */

export const COMPRESSION_LEVELS = ['gentle', 'light', 'standard', 'aggressive', 'max']

export const DEFAULT_LEVEL = 'standard'

/** Legacy id written by older integrations; read as the gentlest tier. */
export const LEGACY_COMPRESSION_LEVELS = { off: 'gentle' }

export const COMPRESSION = {
  gentle: {
    label: '极轻',
    auto: true,
    manual: true,
    thresholdRatio: 0.8,
    retainRatio: 0.2,
    summary: '最贵的一档：对齐官方默认，窗口约用到 80% 才压缩，保留约 20% 原文。',
  },
  light: {
    label: '轻量',
    auto: true,
    manual: true,
    thresholdRatio: 0.7,
    retainRatio: 0.18,
    summary: '比官方默认更早：约 70% 触发压缩，保留约 18% 原文。',
  },
  standard: {
    label: '标准',
    auto: true,
    manual: true,
    thresholdRatio: 0.6,
    retainRatio: 0.16,
    summary: '默认：大约用到窗口的 60% 时压缩，近期约 16% 保持原文，长对话更省。',
  },
  aggressive: {
    label: '积极',
    auto: true,
    manual: true,
    thresholdRatio: 0.5,
    retainRatio: 0.1,
    summary: '一半窗口就压缩，只把较短的尾部留成原文，进一步压成本。',
  },
  max: {
    label: '最大',
    auto: true,
    manual: true,
    thresholdRatio: 0.4,
    retainRatio: 0.06,
    summary: '最省：到窗口 40% 就把旧上下文收成一条摘要。',
  },
}

export function compactLevel(level) {
  const mapped = Object.hasOwn(LEGACY_COMPRESSION_LEVELS, level) ? LEGACY_COMPRESSION_LEVELS[level] : level
  return Object.hasOwn(COMPRESSION, mapped) ? mapped : DEFAULT_LEVEL
}

export function compressionSpec(level) {
  if (!Object.hasOwn(COMPRESSION, level)) {
    throw new Error(`Unknown compression level: ${level}`)
  }
  return COMPRESSION[level]
}

/**
 * Strict input parser for tools and HTTP writes: unknown ids are rejected
 * instead of silently falling back, so a typo cannot change the tier.
 */
export function parseLevel(value) {
  const cleaned = value === undefined || value === null ? '' : String(value).trim().toLowerCase()
  if (!cleaned) throw new Error(`Unknown compression level: ${value}`)
  if (Object.hasOwn(COMPRESSION, cleaned)) return cleaned
  if (Object.hasOwn(LEGACY_COMPRESSION_LEVELS, cleaned)) return LEGACY_COMPRESSION_LEVELS[cleaned]
  throw new Error(`Unknown compression level: ${value} (expected one of ${COMPRESSION_LEVELS.join(', ')})`)
}

/** Official default headroom; the tier ratios are capped by it. */
export const COMPACTION_HEADROOM_TOKENS = 65536
/** Windows below this make the five ratios collapse onto the same effective cap. */
export const LONG_WINDOW_TOKENS = 262144

/**
 * Official trigger formula: `floor(min(W × thresholdRatio, W − O − 65536))`.
 * `O` (the request output reserve) is unknown here, so callers pass 0 for an
 * upper bound. Returns `null` when the window cannot fit the official headroom
 * or the retain budget would reach the trigger.
 */
export function effectiveCompaction(level, windowTokens, outputReserveTokens = 0) {
  const spec = compressionSpec(level)
  const window = Number(windowTokens)
  const reserve = Number(outputReserveTokens)
  if (!Number.isFinite(window) || window <= 0) return null
  if (!Number.isFinite(reserve) || reserve < 0) return null
  const thresholdTokens = Math.floor(Math.min(window * spec.thresholdRatio, window - reserve - COMPACTION_HEADROOM_TOKENS))
  const retainTokens = Math.floor((window - reserve) * spec.retainRatio)
  if (!Number.isFinite(thresholdTokens) || thresholdTokens <= 0) return null
  if (retainTokens >= thresholdTokens) return null
  return { thresholdTokens, retainTokens }
}

/** Number of distinct automatic thresholds the five tiers actually reach. */
export function distinctThresholds(windowTokens, outputReserveTokens = 0) {
  const values = COMPRESSION_LEVELS
    .map((id) => effectiveCompaction(id, windowTokens, outputReserveTokens))
    .filter(Boolean)
    .map((item) => item.thresholdTokens)
  return new Set(values).size
}

/**
 * Match a live compaction policy back to a tier. Used on first install so the
 * plugin can adopt the policy already in force instead of changing it.
 * Absolute `retainTokens` policies have no tier equivalent and return `null`.
 */
export function levelForPolicy(config) {
  if (!config || typeof config !== 'object') return null
  const threshold = Number(config.thresholdRatio)
  const retain = Number(config.retainRatio)
  if (!Number.isFinite(threshold) || !Number.isFinite(retain)) return null
  for (const id of COMPRESSION_LEVELS) {
    const spec = COMPRESSION[id]
    if (Math.abs(spec.thresholdRatio - threshold) < 1e-9 && Math.abs(spec.retainRatio - retain) < 1e-9) return id
  }
  return null
}

/** Compaction config written into every mounted preset engine. */
export function presetCompactionConfig(spec, routes = []) {
  const config = {
    auto: spec.auto,
    thresholdRatio: spec.thresholdRatio,
    retainRatio: spec.retainRatio,
  }
  if (Array.isArray(routes) && routes.length > 0) {
    config.modelPolicies = routes.map((route) => ({
      provider: route.provider,
      model: route.model,
      headroomTokens: route.headroomTokens,
      ...(route.retainTokens === undefined ? {} : { retainTokens: route.retainTokens }),
    }))
  }
  return config
}

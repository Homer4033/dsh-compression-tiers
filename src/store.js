import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_LEVEL, compactLevel } from './levels.js'
import { normalizeRoutes } from './routes.js'

/**
 * Plugin-owned state. The selected tier and the optional per-route overrides
 * live in the DSH home so they survive profile rebuilds and DSH upgrades:
 *
 * `<home>/compression-tiers/settings.json`
 *
 * The file is the single source of truth; the live compaction engines are a
 * derived cache that the reconciler rewrites.
 */

export function defaultGithubSettings() {
  return {
    // Empty means "use this plugin's own checkout"; the panel shows the result.
    repoPath: '',
    remote: 'origin',
    branch: '',
    // Empty means "detect": git's http.proxy, then the system proxy.
    proxy: '',
  }
}

export function defaultSettings() {
  return {
    level: DEFAULT_LEVEL,
    modelRoutes: [],
    lastCompact: null,
    github: defaultGithubSettings(),
  }
}

function text(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function normalizeSettings(value) {
  const base = defaultSettings()
  const next = { ...base, ...(value && typeof value === 'object' ? value : {}) }
  next.level = compactLevel(next.level)
  next.modelRoutes = normalizeRoutes(next.modelRoutes)
  next.lastCompact = next.lastCompact && typeof next.lastCompact === 'object' ? next.lastCompact : null
  const github = value && typeof value === 'object' && value.github && typeof value.github === 'object' ? value.github : {}
  next.github = {
    repoPath: text(github.repoPath, base.github.repoPath),
    remote: text(github.remote, base.github.remote),
    branch: text(github.branch, base.github.branch),
    proxy: text(github.proxy, base.github.proxy),
  }
  return next
}

export function settingsPaths(home) {
  const dir = join(home, 'compression-tiers')
  return {
    home,
    dir,
    settings: join(dir, 'settings.json'),
  }
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    // Hand edits often carry a UTF-8 BOM; strip it before parsing.
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return fallback
  }
}

/** Same-directory temp file + rename: a reader never sees a half-written file. */
export function writeText(path, text) {
  mkdirSync(join(path, '..'), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, path)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // The temp file may not have been created at all.
    }
    throw error
  }
}

export function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function readSettings(home) {
  const paths = settingsPaths(home)
  const raw = readJson(paths.settings, undefined)
  return {
    paths,
    exists: raw !== undefined,
    settings: normalizeSettings(raw),
  }
}

export function writeSettings(home, patch) {
  const current = readSettings(home)
  const settings = normalizeSettings({
    ...current.settings,
    ...(patch && patch.settings ? patch.settings : {}),
  })
  writeJson(current.paths.settings, settings)
  return { ...readSettings(home), settings }
}

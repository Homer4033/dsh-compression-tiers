/**
 * Apply the selected tier to the compaction engines that actually run.
 *
 * In the official composition the host-plane `compaction-basic` row is
 * disabled and every agent preset mounts its own isolated `compaction-basic`
 * engine. A profile patch therefore cannot reach those rows; this module walks
 * the live preset mounts and updates their rows through the Cordis loader,
 * which restarts just that plugin with the new policy.
 *
 * Everything here is defensive: a DSH upgrade may change the private preset
 * structure, and a miss must leave the official engine untouched instead of
 * breaking preset activation.
 */

import { presetCompactionConfig } from './levels.js'

export const COMPACTION_PLUGIN = '@deepseek-ai/dsh-compaction-basic'

/**
 * Live `compaction-basic` entries inside every mounted agent preset.
 * @param {unknown} agentPresets - the `agentPresets` service.
 * @returns {Array<{ options?: { config?: unknown, name?: string }, disabled?: boolean, update?: Function }>}
 */
export function presetCompactionEntries(agentPresets) {
  const rows = []
  const definitions = agentPresets && agentPresets.definitions
  if (!definitions || typeof definitions.values !== 'function') return rows
  for (const record of definitions.values()) {
    const tree = record && record.generation && record.generation.mount && record.generation.mount.tree
    if (!tree || typeof tree.entries !== 'function') continue
    for (const entry of tree.entries()) {
      if (!entry || entry.disabled) continue
      if (!entry.options || entry.options.name !== COMPACTION_PLUGIN) continue
      if (typeof entry.update !== 'function') continue
      rows.push(entry)
    }
  }
  return rows
}

/**
 * Read the policy currently mounted in each preset engine.
 * @param {unknown} agentPresets - the `agentPresets` service.
 * @returns {Array<{ id: string, auto: boolean, thresholdRatio?: number, retainRatio?: number, modelPolicies: number }>}
 */
export function presetEnginePolicies(agentPresets) {
  return presetCompactionEntries(agentPresets).map((entry) => {
    const config = entry.options && entry.options.config && typeof entry.options.config === 'object'
      ? entry.options.config
      : {}
    return {
      id: String(entry.options.id ?? ''),
      auto: config.auto !== false,
      ...(config.thresholdRatio === undefined ? {} : { thresholdRatio: config.thresholdRatio }),
      ...(config.retainRatio === undefined ? {} : { retainRatio: config.retainRatio }),
      modelPolicies: Array.isArray(config.modelPolicies) ? config.modelPolicies.length : 0,
    }
  })
}

function sameConfig(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/**
 * Update every mounted preset engine to the selected tier. Only engines whose
 * policy differs are restarted, so a reconcile pass is cheap and idempotent.
 * @param {unknown} agentPresets - the `agentPresets` service.
 * @param {object} spec - one `COMPRESSION` entry.
 * @param {Array} [routes] - parsed model route overrides.
 * @returns {Promise<{ presets: number, updated: number }>}
 */
export async function syncPresetCompaction(agentPresets, spec, routes = []) {
  const entries = presetCompactionEntries(agentPresets)
  let updated = 0
  for (const entry of entries) {
    const current = entry.options && entry.options.config && typeof entry.options.config === 'object'
      ? entry.options.config
      : {}
    const next = presetCompactionConfig(spec, routes)
    // Preserve fields this plugin does not own. `retainRatio` and
    // `retainTokens` are mutually exclusive, so a stale absolute tail is
    // dropped when the tier owns the ratio.
    const merged = { ...current, ...next }
    delete merged.retainTokens
    if (!next.modelPolicies) delete merged.modelPolicies
    if (sameConfig(current, merged)) continue
    await entry.update({ config: merged })
    updated += 1
  }
  return { presets: entries.length, updated }
}

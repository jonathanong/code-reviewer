import type { Pillar } from './pillar-name.mts'
import type { ExtraPillar } from './pillar-name.mts'
import type { PillarSettings } from './pillars-settings.mts'
import type { PillarMode } from './rules/pillars-parse.mts'

/**
 * Applies the configured pillars to a plan's selection: disabled built-ins leave `run` with a
 * reason, and the extras that run are returned. An extra runs in the modes it names, and also when
 * it has an open finding, so a follow-up can check the fix. A push that only merges the base or
 * rewrites history (`merge`) re-checks mechanically, so only an extra with an open finding runs.
 */
export function applyPillarSettings(
  run: Set<Pillar>,
  why: Map<Pillar, string>,
  settings: PillarSettings,
  context: { mode: PillarMode; merge: boolean; open: readonly string[] },
): ExtraPillar[] {
  for (const name of settings.disabled) {
    run.delete(name)
    why.set(name, 'Disabled in config.')
  }
  return settings.extra
    .filter(
      (entry) =>
        context.open.includes(entry.name) || (!context.merge && entry.modes.includes(context.mode)),
    )
    .map((entry) => entry.name)
}

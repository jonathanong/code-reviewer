import type { RepoConfig, RepoConfigs } from './rules/config.mts'
import { candidates, type SettingLayer } from './settings.mts'
import { targetNamesIn, type ReviewTarget } from './targets.mts'

/** Which built-in targeted checks are switched off; empty list means all are enabled. */
export type TargetSettings = {
  disabled: readonly string[] | 'all'
}

export const NO_DISABLED_TARGETS: TargetSettings = { disabled: [] }

export type ResolvedTargets = TargetSettings & {
  enabled: string[]
  from: SettingLayer
}

/**
 * Resolves `targets` for `owner/name` (or `owner`): the highest layer that sets `targets.disabled`
 * wins (machine repo file, machine owner file, then the repository's own file). Default: all
 * targets in `<referencesDir>/targets/` enabled.
 */
export function resolveTargets(
  configs: RepoConfigs,
  scope: string,
  target: RepoConfig | undefined,
  referencesDir: string,
): ResolvedTargets {
  const known = targetNamesIn(referencesDir)
  const hit = candidates(configs, scope, target).find(
    ([, config]) => config?.targets?.disabled !== undefined,
  )
  const disabled = hit?.[1]?.targets?.disabled ?? []
  const enabled =
    disabled === 'all'
      ? []
      : known.filter((name) => !(disabled as readonly string[]).includes(name))
  return { disabled, enabled, from: hit?.[0] ?? 'default' }
}

/** Keeps the targets that `settings` leaves enabled. */
export function filterTargets(
  all: readonly ReviewTarget[],
  settings: TargetSettings = NO_DISABLED_TARGETS,
): ReviewTarget[] {
  if (settings.disabled === 'all') return []
  const disabled = settings.disabled
  return all.filter((target) => !disabled.includes(target.name))
}

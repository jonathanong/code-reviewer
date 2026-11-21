import { DISPATCHED_PILLARS, type DispatchedPillar } from './pillar-name.mts'
import type { RepoConfig, RepoConfigs } from './rules/config.mts'
import { PILLAR_MODES, type ExtraPillarConfig, type PillarMode } from './rules/pillars-parse.mts'
import { candidates, type SettingLayer } from './settings.mts'

/** Which built-in pillars are off and which extra pillars run. */
export type PillarSettings = {
  disabled: readonly DispatchedPillar[]
  extra: readonly ExtraPillarConfig[]
}

export const NO_PILLARS: PillarSettings = { disabled: [], extra: [] }

export type ResolvedPillars = PillarSettings & {
  from: { disabled: SettingLayer; extra: SettingLayer }
  /** Reasons the settings cannot run a review; a review command refuses to start with any. */
  problems: string[]
}

/**
 * The pillars for `owner/name` (or `owner`). `disabled` and `extra` each come whole from the
 * highest layer that sets them (machine repo file, machine owner file, then the repository's own
 * file, read from its default branch); a list never appends to a lower layer's.
 */
export function resolvePillars(
  configs: RepoConfigs,
  scope: string,
  target?: RepoConfig,
): ResolvedPillars {
  const layers = candidates(configs, scope, target)
  const layerOf = (key: 'disabled' | 'extra') =>
    layers.find(([, config]) => config?.pillars?.[key] !== undefined)
  const disabled = layerOf('disabled')
  const extra = layerOf('extra')
  const settings: PillarSettings = {
    disabled: disabled?.[1]?.pillars?.disabled ?? [],
    extra: extra?.[1]?.pillars?.extra ?? [],
  }
  const allOff = settings.disabled.length === DISPATCHED_PILLARS.length
  const problems = PILLAR_MODES.filter(
    (mode) => allOff && !settings.extra.some((entry) => entry.modes.includes(mode)),
  ).map(
    (mode) =>
      `pillars: every built-in pillar is disabled and no extra pillar runs in ${mode} reviews`,
  )
  return {
    ...settings,
    from: { disabled: disabled?.[0] ?? 'default', extra: extra?.[0] ?? 'default' },
    problems,
  }
}

/** The pillars a review runs with; throws when the settings leave a mode with no pillar at all. */
export function requirePillars(
  configs: RepoConfigs,
  scope: string,
  target?: RepoConfig,
): PillarSettings {
  const { problems, disabled, extra } = resolvePillars(configs, scope, target)
  if (problems.length > 0) throw new Error(problems.join('; '))
  return { disabled, extra }
}

/** The built-in pillars that can run in a light review; a full review can run every one. */
const LIGHT_BUILTINS: readonly DispatchedPillar[] = ['rules', 'correctness', 'security']

/** What `settings` prints: each extra without its text, and the pillars that may run per mode. */
export function describePillars(resolved: ResolvedPillars) {
  const enabled = (pool: readonly DispatchedPillar[]) =>
    pool.filter((name) => !resolved.disabled.includes(name))
  const forMode = (mode: PillarMode, pool: readonly DispatchedPillar[]): string[] => [
    ...enabled(pool),
    ...resolved.extra.filter((entry) => entry.modes.includes(mode)).map((entry) => entry.name),
  ]
  return {
    disabled: resolved.disabled,
    extra: resolved.extra.map(({ name, modes, when, source }) => ({
      name,
      modes,
      ...(when === undefined ? {} : { when }),
      uses: 'run' in source ? ('run' as const) : ('prompt' as const),
    })),
    modes: { light: forMode('light', LIGHT_BUILTINS), full: forMode('full', DISPATCHED_PILLARS) },
    from: resolved.from,
    problems: resolved.problems,
  }
}

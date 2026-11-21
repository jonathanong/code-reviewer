import { isCeiling } from './rules/limits-parse.mts'
import type { RepoConfigs } from './rules/config.mts'
import { machineSetting, type MachineLayer } from './settings.mts'

export type LimitSettings = {
  /** The most a review may cost in US dollars before no further step starts; undefined means no ceiling. */
  maxCostUsd: number | undefined
  /** The machine layer whose `limits.maxCostUsd` applies; null when none sets one. */
  from: MachineLayer
}

/**
 * The limits for `owner/name` (or `owner`): the highest machine layer that sets `limits`. The
 * reviewed repository's own file is never consulted, so it cannot lift the ceiling.
 */
export function resolveLimits(configs: RepoConfigs, scope: string): LimitSettings {
  const { value, from } = machineSetting(configs, scope, 'limits')
  return { maxCostUsd: value?.maxCostUsd, from: value?.maxCostUsd === undefined ? null : from }
}

/** `--max-cost USD`: a number above zero. Throws a message fit for a usage error. */
export function parseMaxCost(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const usd = value.trim() === '' ? Number.NaN : Number(value)
  if (!isCeiling(usd)) throw new Error('--max-cost must be a number of US dollars greater than 0.')
  return usd
}

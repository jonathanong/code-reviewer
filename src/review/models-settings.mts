import { resolveModelPlan, type Candidate, type ModelPlan } from './models.mts'
import type { RepoConfigs } from './rules/config.mts'
import { machineSetting, type MachineLayer } from './settings.mts'

export type ModelSettings = {
  plan: ModelPlan
  /** The machine layer whose `models` applies; null when none sets one, which leaves the defaults. */
  from: MachineLayer
}

/**
 * The models for `owner/name` (or `owner`): the highest machine layer that sets `models`, over the
 * defaults, then the `--model` overrides. The reviewed repository's own file is never consulted.
 */
export function resolveModels(
  configs: RepoConfigs,
  scope: string,
  overrides: Record<string, Candidate[]> = {},
): ModelSettings {
  const { value, from } = machineSetting(configs, scope, 'models')
  return { plan: resolveModelPlan(value, overrides), from }
}

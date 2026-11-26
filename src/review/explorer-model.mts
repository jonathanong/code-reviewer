import { DEFAULT_EXPLORER_MODEL } from '../harness/claude-args.mts'
import type { ModelPlan } from './models.mts'

/** The model the `explorer` subagent runs on: the first Claude candidate of `small`, else the default. */
export function explorerModelFor(plan: ModelPlan): string {
  return (
    plan.tiers.small.find((candidate) => candidate.harness === 'claude')?.model ??
    DEFAULT_EXPLORER_MODEL
  )
}

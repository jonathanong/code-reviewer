import { candidatesFor, DEFAULT_STEPS, resolveModelPlan, STEP_NAMES, stepKeys } from './models.mts'
import type { ModelConfig, Tier } from './models.mts'
import { stepProblems } from './step-check.mts'

/**
 * What a `models` config would make a step unable to run, each step resolved as the runner will
 * resolve it (its own list, then its tier, then the default tier).
 */
export function modelConfigProblems(config: ModelConfig): string[] {
  const plan = resolveModelPlan(config)
  const found = [...new Set(STEP_NAMES)].flatMap((step) =>
    stepProblems(
      step,
      candidatesFor(plan, stepKeys(step), (DEFAULT_STEPS[step] ?? DEFAULT_STEPS.pillars) as Tier),
    ),
  )
  return [...new Set(found)]
}

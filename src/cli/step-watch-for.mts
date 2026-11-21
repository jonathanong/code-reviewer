import { parseMaxCost, type LimitSettings } from '../review/limits-settings.mts'
import { createStepWatch, type StepWatch } from '../review/step-watch.mts'
import type { ReviewDeps } from './deps.mts'

/**
 * Progress to stderr unless `--quiet`, and the cost ceiling: `--max-cost` over the machine
 * config's `limits.maxCostUsd`.
 */
export function stepWatchFor(
  values: { 'max-cost'?: string | undefined; quiet?: boolean | undefined },
  limits: LimitSettings,
  deps: ReviewDeps,
): StepWatch {
  const ceilingUsd = parseMaxCost(values['max-cost']) ?? limits.maxCostUsd
  return createStepWatch({
    ...(values.quiet === true ? {} : { write: (line: string) => deps.progress(line) }),
    now: () => deps.tracker().now().getTime(),
    ceilingUsd,
  })
}

import { parseMaxCost, resolveLimits } from '../review/limits-settings.mts'
import { createStepWatch, type StepWatch } from '../review/step-watch.mts'
import type { ReviewDeps } from './deps.mts'

/**
 * Progress to stderr unless `--quiet`, and the cost ceiling: `--max-cost` over the machine
 * config's `limits.maxCostUsd`, which is read last so a flag never needs the config.
 */
export function stepWatchFor(
  values: { 'max-cost'?: string | undefined; quiet?: boolean | undefined },
  repo: string,
  deps: ReviewDeps,
): StepWatch {
  const ceilingUsd =
    parseMaxCost(values['max-cost']) ?? resolveLimits(deps.configs(), repo).maxCostUsd
  return createStepWatch({
    ...(values.quiet === true ? {} : { write: (line: string) => deps.progress(line) }),
    now: () => deps.tracker().now().getTime(),
    ...(ceilingUsd === undefined ? {} : { ceilingUsd }),
  })
}

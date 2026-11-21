import type { SkippedPillar } from '../finding.mts'
import type { StepModels } from '../models.mts'
import { APPROVAL_CHECK } from '../skipped.mts'

/**
 * A review that lost a step to the cost ceiling is not given an approval, the way an approval
 * whose second check did not complete is not: it lists `APPROVAL_CHECK` under `skipped`, which
 * `deriveVerdict` turns into a comment. An entry already there says the same and stays.
 */
export function withCeilingSkip(
  skipped: readonly SkippedPillar[],
  models: StepModels,
): SkippedPillar[] {
  const reason = models.watch?.skippedFor
  if (reason === undefined || skipped.some((entry) => entry.pillar === APPROVAL_CHECK)) {
    return [...skipped]
  }
  return [...skipped, { pillar: APPROVAL_CHECK, reason: `${reason}, so this is not an approval.` }]
}

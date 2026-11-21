import { ReviewError } from '../finding.mts'
import { saveFailedSteps } from './failed-steps.mts'
import type { PillarResult } from './types.mts'

/**
 * A review with no pillar answer would approve unchecked code, so it fails instead: either every
 * pillar failed, or the pillars config left none planned for this change.
 */
export function requireAnswer(results: readonly PillarResult[], out: string): void {
  if (results.length === 0) {
    throw new ReviewError(
      'No pillar is planned for this change: the pillars config disables them all.',
    )
  }
  if (results.every((result) => result.error !== undefined)) {
    saveFailedSteps(
      out,
      results.map((result) => ({ step: result.pillar, ran: result.ran })),
    )
    throw new ReviewError(
      `Every pillar failed: ${results.map((result) => `${result.pillar} (${(result.error as string).split('\n')[0]})`).join('; ')}`,
    )
  }
}

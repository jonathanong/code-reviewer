import { join } from 'node:path'

import type { StepRan } from '../../harness/runner.mts'
import { FAILED_STEPS_FILE } from '../../tracker/failures.mts'
import { writeJson } from './review-support.mts'

/**
 * A review that stops before its report is written has no `ran` list. Saves the steps of a review that is about to fail because of their harness, so the tracker can
 * count them. A step whose `ran` carries no harness failure is left out; nothing is written then.
 */
export function saveFailedSteps(
  out: string,
  steps: ReadonlyArray<{ step: string; ran: StepRan | undefined }>,
): void {
  const rows = steps.flatMap(({ step, ran }) =>
    ran?.failure === undefined ? [] : [{ step, ...ran }],
  )
  if (rows.length > 0) writeJson(join(out, FAILED_STEPS_FILE), rows)
}

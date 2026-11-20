import type { Mode } from '../mode.mts'
import type { ReviewPlan } from '../plan.mts'
import { buildReport } from './report.mts'
import { writeReportFiles } from './report-file.mts'
import { skipResult, type ReviewResult, type ReviewSteps } from './review-support.mts'

/** Posts the skip review for a plan that will not review, closes the claim, and writes the report. */
export async function skipReview(
  steps: ReviewSteps,
  plan: ReviewPlan,
  base: {
    repo: string
    pr: number
    title: string
    headSha: string
    effort: ReviewPlan['effort']
    mode: Mode
  },
  out: string,
  closed: { value: boolean },
): Promise<ReviewResult> {
  const skipReason = plan.skipReason as string
  await steps.skip(skipReason, base.headSha)
  closed.value = true
  const data = buildReport({
    ...base,
    reasons: plan.reasons,
    skipReason,
    verdict: null,
    skipped: plan.skipped,
    skillSelection: { selected: [], available: 0, usage: null },
    pillars: [],
  })
  return skipResult(base.mode, base.headSha, writeReportFiles(out, data))
}

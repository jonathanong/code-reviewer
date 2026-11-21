import { join } from 'node:path'

import type { Finding } from '../finding.mts'
import type { Question } from '../question.mts'
import type { ApprovalCheck } from './approval-check.mts'
import { costBreakdown, type ReportData } from './report.mts'
import { countFindings } from './review-support.mts'

/** The summary line a finished review prints. */
export function reviewSummary(input: {
  data: ReportData
  verified: readonly Finding[]
  questions: readonly Question[]
  check: ApprovalCheck | undefined
  report: string
  out: string
  headSha: string
}) {
  const { data } = input
  return {
    claimed: true,
    mode: data.mode,
    verdict: data.verdict,
    findings: countFindings(input.verified),
    questions: input.questions.length,
    ...(input.check === undefined ? {} : { approvalCheck: input.check.outcome }),
    costUsd: costBreakdown(data).total,
    report: input.report,
    review: join(input.out, 'review.json'),
    headSha: input.headSha,
    fixedThreadIds: data.fixedThreadIds,
  }
}

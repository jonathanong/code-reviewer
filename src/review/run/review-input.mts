import type { Dependency } from '../dependency.mts'
import type { Effort, Finding, ReviewInput, SkippedPillar } from '../finding.mts'
import type { Question } from '../question.mts'
import { noteFields } from './review-support.mts'
import type { RunDir } from './pillar-prompt.mts'
import type { ReviewVerifierOutput } from './verify.mts'

/** The `review.json` the verifier's answer, the second checks and the run's own notes add up to. */
export function buildReviewInput(parts: {
  effort: Effort
  output: ReviewVerifierOutput
  skipped: SkippedPillar[]
  findings: Finding[]
  questions: Question[]
  run: RunDir
  dependencies: Dependency[]
}): ReviewInput {
  const { effort, output, skipped, findings, questions, run, dependencies } = parts
  return {
    effort,
    summary: output.summary,
    skipped,
    findings,
    questions,
    ...noteFields(run),
    ...(dependencies.length === 0 ? {} : { dependencies }),
    ...(output.regressionPrevent === undefined
      ? {}
      : { regressionPrevent: output.regressionPrevent }),
    ...(output.splitProposal === undefined ? {} : { splitProposal: output.splitProposal }),
    ...(output.impact === undefined ? {} : { impact: output.impact }),
  }
}

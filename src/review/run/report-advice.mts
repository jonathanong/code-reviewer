import type { Answer } from '../answers.mts'
import type { Impact } from '../impact.mts'
import type { ReviewVerifierOutput } from './verify.mts'

/** What the verifier added beside the findings; each part is absent when it gave none. */
export type ReportAdvice = {
  /** The verifier's proposal to split a large change with a mechanical part. */
  splitProposal?: string
  /** The verifier's judgment of the change's kind, with its basis; only a full review asks for it. */
  impact?: Impact
  /** Replies the review will post to other reviewers' threads. */
  answers?: Answer[]
  /** Why an answer the verifier gave was dropped. */
  answerWarnings?: string[]
}

export function reportAdvice(output: ReviewVerifierOutput | undefined): ReportAdvice {
  return {
    ...(output?.splitProposal === undefined ? {} : { splitProposal: output.splitProposal }),
    ...(output?.impact === undefined ? {} : { impact: output.impact }),
    ...(output?.answers === undefined || output.answers.length === 0
      ? {}
      : { answers: output.answers }),
    ...(output?.answerWarnings === undefined || output.answerWarnings.length === 0
      ? {}
      : { answerWarnings: output.answerWarnings }),
  }
}

import type { Impact } from '../impact.mts'
import type { ReviewVerifierOutput } from './verify.mts'

/** What the verifier added beside the findings; each part is absent when it gave none. */
export type ReportAdvice = {
  /** The verifier's proposal to split a large change with a mechanical part. */
  splitProposal?: string
  /** The verifier's judgment of the change's kind, with its basis; only a full review asks for it. */
  impact?: Impact
}

export function reportAdvice(output: ReviewVerifierOutput | undefined): ReportAdvice {
  return {
    ...(output?.splitProposal === undefined ? {} : { splitProposal: output.splitProposal }),
    ...(output?.impact === undefined ? {} : { impact: output.impact }),
  }
}

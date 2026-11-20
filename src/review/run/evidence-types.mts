import type { Usage } from '../benchmark/usage.mts'
import type { GuideReader } from '../rules/evidence-guide.mts'
import type { EvidenceSource } from '../rules/evidence-parse.mts'
import type { FailedAttempt } from './types.mts'

export const EVIDENCE_STATUSES = ['checked', 'blocked', 'not-applicable'] as const
export const EVIDENCE_EFFECTS = ['supports', 'contradicts', 'none'] as const

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]
export type EvidenceEffect = (typeof EVIDENCE_EFFECTS)[number]

export type EvidenceCommand = { command: string; result: string }

/** One query the run made, with the control query that shows an empty result means absence. */
export type EvidenceQuery = EvidenceCommand & { control?: EvidenceCommand }

export type EvidenceSourceReport = {
  name: string
  status: EvidenceStatus
  /** Why the source was blocked or not applicable. */
  reason?: string
  queries: EvidenceQuery[]
}

/** What the run concluded about a verified finding; `id` is `F<n>`, its position in the review. */
export type EvidenceFindingNote = {
  id: string
  effect: EvidenceEffect
  note: string
  /** The sources the note rests on; every checked source when absent. */
  sources?: string[]
}

export type EvidenceClaimNote = { claim: string; effect: EvidenceEffect; note: string }

/** The validated answer of the evidence run. */
export type EvidenceOutput = {
  sources: EvidenceSourceReport[]
  findings: EvidenceFindingNote[]
  claims: EvidenceClaimNote[]
}

/**
 * The evidence step's outcome, saved as `evidence.json` and in `report.json`. `error` is set when
 * the run failed twice or could not start; `sources` then holds only what the guides blocked.
 */
export type EvidenceReport = EvidenceOutput & {
  model: string
  error?: string
  usage: Usage | null
  failedAttempts: FailedAttempt[]
}

/** The configured sources and the way to read their guides. */
export type EvidenceSetup = { sources: readonly EvidenceSource[]; readGuide: GuideReader }

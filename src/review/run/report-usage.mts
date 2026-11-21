import type { Usage } from '../benchmark/usage.mts'
import { summarizeModels } from '../benchmark/usage-summary.mts'
import type { EvidenceReport } from './evidence-types.mts'
import type { ReportInput } from './report.mts'

function present(usages: ReadonlyArray<Usage | null>): Usage[] {
  return usages.filter((usage): usage is Usage => usage !== null)
}

export function evidenceUsages(evidence: EvidenceReport | undefined): Array<Usage | null> {
  return evidence === undefined
    ? []
    : [evidence.usage, ...evidence.failedAttempts.map((attempt) => attempt.usage)]
}

/** Tokens and cost per model for each step of the review. */
export function byStep(input: ReportInput) {
  const pillars = input.pillars.flatMap((pillar) => [
    pillar.usage,
    ...pillar.failedAttempts.map((attempt) => attempt.usage),
  ])
  return [
    { name: 'selection', models: summarizeModels(present([input.skillSelection.usage])) },
    { name: 'pillars', models: summarizeModels(present(pillars)) },
    { name: 'verifier', models: summarizeModels(present([input.verifier?.output.usage ?? null])) },
    ...(input.evidence === undefined
      ? []
      : [{ name: 'evidence', models: summarizeModels(present(evidenceUsages(input.evidence))) }]),
    ...(input.approvalCheck === undefined
      ? []
      : [
          { name: 'approval check', models: summarizeModels(present([input.approvalCheck.usage])) },
        ]),
  ]
}

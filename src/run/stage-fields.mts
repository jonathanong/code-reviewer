import type { RunFacts } from './facts.mts'
import type { Counts, RunLine } from './output.mts'

export function reviewFields(
  base: Partial<RunLine>,
  summary: Record<string, unknown>,
  facts: RunFacts,
): Partial<RunLine> {
  return {
    ...base,
    verdict: summary.verdict as string,
    findings: summary.findings as Counts,
    questions: facts.questions,
    flags: facts.flags,
    costUsd: summary.costUsd as number,
    tokens: facts.tokens,
    mode: summary.mode as string,
    approvalCheck: (summary.approvalCheck ?? null) as RunLine['approvalCheck'],
  }
}

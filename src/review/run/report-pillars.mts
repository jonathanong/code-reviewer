import type { ReviewVerifierOutput } from './verify.mts'
import type { ReportFinding, ReportPillar } from './report.mts'
import type { PillarResult } from './types.mts'

/** Each pillar's findings, marked dropped (with the verifier's reason) when no output finding keeps them. */
export function markDropped(
  pillars: readonly PillarResult[],
  output: ReviewVerifierOutput | undefined,
): ReportPillar[] {
  const kept = new Set(output?.sources.flat() ?? [])
  return pillars.map((result, position) => {
    const start = pillars
      .slice(0, position)
      .reduce((total, earlier) => total + earlier.findings.length, 0)
    return {
      pillar: result.pillar,
      model: result.model,
      skills: result.skills,
      usage: result.usage,
      ...(result.error === undefined ? {} : { error: result.error }),
      failedAttempts: result.failedAttempts,
      findings: result.findings.map((finding, at): ReportFinding => {
        const here = start + at
        if (output === undefined || kept.has(here)) return { ...finding, dropped: false }
        const reason = output.dropped.get(here)
        return {
          ...finding,
          dropped: true,
          ...(reason === undefined ? {} : { droppedReason: reason }),
        }
      }),
    }
  })
}

import { isObject } from '../../harness/json.mts'
import type { HarnessResult } from '../../harness/types.mts'
import { ReviewError, parseReviewInput, type Finding } from '../finding.mts'
import { type Pillar } from '../pillar-name.mts'
import type { Usage } from '../benchmark/usage.mts'

export type PillarOutput = { findings: Finding[]; skills: string[]; usage: Usage }

/** Reads a pillar run: its findings tagged with the pillar, the skills it loaded, and usage. */
export function parsePillarOutput(run: HarnessResult, pillar: Pillar): PillarOutput {
  const found = (run.structured as { findings?: unknown } | undefined)?.findings
  if (!Array.isArray(found)) {
    throw new ReviewError('Pillar run returned no structured findings.')
  }
  const findings = found.map((finding: unknown) =>
    isObject(finding) ? { ...finding, pillar } : finding,
  )
  return { findings: parseReviewInput({ findings }).findings, skills: run.skills, usage: run.usage }
}

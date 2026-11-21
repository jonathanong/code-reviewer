import { join } from 'node:path'

import type { Pillar } from '../pillar-name.mts'
import type { EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { currentAssignment, type RawResult } from './judge-all.mts'
import { scoreCase, type CaseScore } from './score.mts'
import type { Usage } from './usage.mts'
import { expectedSkillsFor, scoreSkills, type SkillCase } from './skills-score.mts'

export type CaseResult =
  | { error: string; usage: Usage | null }
  | { score: CaseScore; skillCase: SkillCase | null; skillTool: boolean; usage: Usage | null }

/**
 * Reads one saved raw result and scores it. With `judge`, a result lacking a current judgement
 * is an error rather than a location-matched score.
 */
export function readCaseResult(
  item: EvalCase,
  pillar: Pillar,
  out: string,
  judge: string | undefined,
  deps: Pick<BenchDeps, 'exists' | 'readFile'>,
): CaseResult {
  const path = join(out, 'raw', pillar, `${item.id}.json`)
  if (!deps.exists(path)) return { error: 'not run', usage: null }
  const raw = JSON.parse(deps.readFile(path)) as RawResult
  // Results saved before usage was recorded have none: missing, not zero.
  const usage = raw.usage ?? null
  if ('error' in raw) return { error: raw.error, usage }
  let assignment: ReturnType<typeof currentAssignment>
  if (judge !== undefined) {
    const expected = item.expected.filter((entry) => entry.pillar === pillar)
    assignment = currentAssignment(raw, expected, judge)
    // Unjudged cases stay out of judged metrics rather than falling back to locations.
    if (assignment === undefined) return { error: 'not judged', usage }
  }
  const score = scoreCase(item, pillar, raw.findings, assignment)
  const wanted = expectedSkillsFor(item, pillar)
  const caught = score.expected > 0 && score.matched === score.expected
  // Results saved before skills were recorded count as nothing loaded.
  const skillCase = wanted.length > 0 ? scoreSkills(item, wanted, raw.skills ?? [], caught) : null
  return { score, skillCase, skillTool: raw.skillTool !== false, usage }
}

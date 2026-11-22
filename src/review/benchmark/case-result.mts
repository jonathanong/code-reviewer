import { join } from 'node:path'

import type { BenchEffort } from '../../harness/types.mts'
import type { ExcerptsMode } from '../context/types.mts'
import type { Pillar } from '../pillar-name.mts'
import type { EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { currentAssignment, type RawResult } from './judge-all.mts'
import { scoreCase, type CaseScore } from './score.mts'
import type { Usage } from './usage.mts'
import { expectedReadsFor, scoreReads, type ReadCase } from './reads-score.mts'
import { expectedSkillsFor, scoreSkills, type SkillCase } from './skills-score.mts'

export type CaseResult =
  | {
      error: string
      usage: Usage | null
      excerpts: ExcerptsMode | null
      harness: string | null
      shell: string[] | null
      onlyPath: string[] | null
      effort: BenchEffort | null
      rounds: number | null
    }
  | {
      score: CaseScore
      skillCase: SkillCase | null
      /** Expected reads opened; separate from the finding score. Null when the case expects none. */
      readCase: ReadCase | null
      skillTool: boolean
      usage: Usage | null
      /** The `--excerpts` arm of the run; null when the flag was not given. */
      excerpts: ExcerptsMode | null
      /** Distinct skills the run loaded; null for a result saved before they were recorded. */
      skillLoads: number | null
      /** The harness recorded on the result; null for Claude and for results saved before it was recorded. */
      harness: string | null
      /** The shell prefixes recorded on the result; null for a normal run. */
      shell: string[] | null
      /** The `--only-path` paths recorded on the result; null for a normal run. */
      onlyPath: string[] | null
      /** The `--effort` recorded on the result; null for the default and for older results. */
      effort: BenchEffort | null
      rounds: number | null
      /** A later round's failure; the earlier rounds' findings are still scored. */
      roundError: string | null
    }

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
  if (!deps.exists(path))
    return {
      error: 'not run',
      usage: null,
      excerpts: null,
      harness: null,
      shell: null,
      onlyPath: null,
      effort: null,
      rounds: null,
    }
  const raw = JSON.parse(deps.readFile(path)) as RawResult
  // Results saved before usage was recorded have none: missing, not zero.
  const usage = raw.usage ?? null
  const excerpts = raw.excerpts ?? null
  const harness = raw.harness ?? null
  const shell = raw.shell ?? null
  const onlyPath = raw.onlyPath ?? null
  const effort = raw.effort ?? null
  const rounds = raw.rounds ?? null
  if ('error' in raw)
    return { error: raw.error, usage, excerpts, harness, shell, onlyPath, effort, rounds }
  let assignment: ReturnType<typeof currentAssignment>
  if (judge !== undefined) {
    const expected = item.expected.filter((entry) => entry.pillar === pillar)
    assignment = currentAssignment(raw, expected, judge)
    // Unjudged cases stay out of judged metrics rather than falling back to locations.
    if (assignment === undefined)
      return { error: 'not judged', usage, excerpts, harness, shell, onlyPath, effort, rounds }
  }
  const score = scoreCase(item, pillar, raw.findings, assignment)
  const wanted = expectedSkillsFor(item, pillar)
  const caught = score.expected > 0 && score.matched === score.expected
  // Results saved before skills were recorded count as nothing loaded.
  const skillCase = wanted.length > 0 ? scoreSkills(item, wanted, raw.skills ?? [], caught) : null
  const readList = expectedReadsFor(item, pillar)
  return {
    score,
    skillCase,
    readCase: readList.length > 0 ? scoreReads(item, readList, raw) : null,
    skillTool: raw.skillTool !== false,
    usage,
    excerpts,
    skillLoads: raw.skills?.length ?? null,
    harness,
    shell,
    onlyPath,
    effort,
    rounds,
    roundError: raw.roundError ?? null,
  }
}

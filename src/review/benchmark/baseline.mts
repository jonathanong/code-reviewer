import { join } from 'node:path'

import type { Pillar } from '../pillar-name.mts'
import { casesForPillar, type EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { readCaseResult } from './case-result.mts'
import type { SkillCase } from './skills-score.mts'

export type BaselineSummary = {
  /** Positives with expectedSkills scored in both runs. */
  cases: number
  /** Grounded catches of this run over those positives. */
  groundedRecall: number | null
  /** Catches of the control run over the same positives. */
  controlRecall: number | null
  /** Grounded recall minus control recall. */
  lift: number | null
  /** Ids the control caught: the case does not discriminate. */
  controlCaught: string[]
}

type ReadDeps = Pick<BenchDeps, 'exists' | 'readFile'>

/** Whether the control run caught each positive with expectedSkills that it scored. */
export function readBaseline(
  cases: readonly EvalCase[],
  pillar: Pillar,
  dir: string,
  judge: string | undefined,
  deps: ReadDeps,
): Map<string, boolean> {
  const caught = new Map<string, boolean>()
  for (const item of casesForPillar(cases, pillar)) {
    const result = readCaseResult(item, pillar, dir, judge, deps)
    if ('error' in result) continue
    const outcome = result.skillCase?.outcome
    if (outcome === undefined || outcome === null) continue
    caught.set(item.id, outcome === 'grounded' || outcome === 'ungrounded')
  }
  return caught
}

/** Compares this run's positives with the control's over the cases both scored. */
export function compareBaseline(
  skillCases: readonly SkillCase[],
  control: ReadonlyMap<string, boolean>,
): BaselineSummary {
  const shared = skillCases.filter((item) => item.outcome !== null && control.has(item.id))
  const grounded = shared.filter((item) => item.outcome === 'grounded').length
  const controlCaught = shared.filter((item) => control.get(item.id)).map((item) => item.id)
  const rate = (count: number) => (shared.length === 0 ? null : count / shared.length)
  const groundedRecall = rate(grounded)
  const controlRecall = rate(controlCaught.length)
  return {
    cases: shared.length,
    groundedRecall,
    controlRecall,
    lift: groundedRecall === null || controlRecall === null ? null : groundedRecall - controlRecall,
    controlCaught,
  }
}

/** One line per case the control caught. */
export function baselineNotes(
  entries: readonly { pillar: Pillar; baseline?: BaselineSummary | undefined }[],
): string[] {
  return entries.flatMap(({ pillar, baseline }) =>
    (baseline?.controlCaught ?? []).map(
      (id) => `- ${pillar}: control caught ${id}: does not discriminate`,
    ),
  )
}

/** Throws when `dir` holds no raw result for any of the pillars' cases. */
export function assertBaseline(
  cases: readonly EvalCase[],
  pillars: readonly Pillar[],
  dir: string,
  deps: Pick<BenchDeps, 'exists'>,
): void {
  const found = pillars.some((pillar) =>
    casesForPillar(cases, pillar).some((item) =>
      deps.exists(join(dir, 'raw', pillar, `${item.id}.json`)),
    ),
  )
  if (!found) throw new Error(`--baseline ${dir} has no raw results for these cases.`)
}

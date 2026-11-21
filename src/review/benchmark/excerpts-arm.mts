import type { ExcerptsMode } from '../context/types.mts'

export type ExcerptsArm = ExcerptsMode | 'mixed'

export type SkillLoads = {
  /** Runs that recorded their loaded skills. */
  runs: number
  total: number
  mean: number | null
}

/** One pillar's arm and loads, as `summary.json` records them for an `--excerpts` run. */
export type ArmSummary = { excerpts: ExcerptsArm | null; skillLoads: SkillLoads }

/** The arm the saved runs share; null when none ran under `--excerpts`. */
export function armOf(runs: ReadonlyArray<ExcerptsMode | null>): ExcerptsArm | null {
  const arms = [...new Set(runs.filter((arm) => arm !== null))]
  if (arms.length === 0) return null
  return arms.length === 1 ? (arms[0] as ExcerptsMode) : 'mixed'
}

/** Distinct skills loaded per run, over the runs that recorded them. */
export function summarizeLoads(loads: ReadonlyArray<number | null>): SkillLoads {
  const known = loads.filter((count) => count !== null)
  const total = known.reduce((sum, count) => sum + count, 0)
  return { runs: known.length, total, mean: known.length === 0 ? null : total / known.length }
}

/** A table of the arm and Skill loads per run; empty unless some pillar ran under `--excerpts`. */
export function renderArms(entries: ReadonlyArray<{ pillar: string; arm: ArmSummary }>): string[] {
  if (entries.every(({ arm }) => arm.excerpts === null)) return []
  const rows = entries.map(({ pillar, arm }) => {
    const mean = arm.skillLoads.mean === null ? 'n/a' : arm.skillLoads.mean.toFixed(1)
    return `| ${pillar} | ${arm.excerpts ?? 'n/a'} | ${arm.skillLoads.runs} | ${arm.skillLoads.total} | ${mean} |`
  })
  return [
    'Excerpts arm and Skill loads (distinct skills loaded through the Skill tool, not calls):',
    [
      '| Pillar | Excerpts | Runs | Skills loaded | Per run |',
      '| --- | --- | --- | --- | --- |',
      ...rows,
    ].join('\n'),
  ]
}

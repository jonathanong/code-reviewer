import { join } from 'node:path'

import type { ExcerptsMode } from '../context/types.mts'
import type { Pillar } from '../pillar-name.mts'
import { casesForPillar, type EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { assertBaseline, baselineNotes, compareBaseline, readBaseline } from './baseline.mts'
import { readCaseResult } from './case-result.mts'
import { renderSummaryTable, summarizePillar, type CaseScore } from './score.mts'
import { skillNotes, type SkillCase } from './skills-score.mts'
import type { Usage } from './usage.mts'
import { renderModelReports, summarizeByModel, type ModelReport } from './model-usage.mts'
import { armOf, renderArms, summarizeLoads, type ArmSummary } from './excerpts-arm.mts'
import { renderCostTable } from './usage-summary.mts'

export type Options = {
  /** Set by `--excerpts`; scoring reads the arm from each saved result. */
  excerpts?: ExcerptsMode | undefined
  out: string
  prompts: string
  model: string
  maxTurns: number
  jobs: number
  scoreOnly: boolean
  judge: string | undefined
  noRules: boolean
  /** Run review's skill-selection step per case and tell each pillar which skills to load. */
  select: boolean
  /** `--out` of an earlier `--no-rules` run of the same cases, for the paired control. */
  baseline?: string | undefined
}

const armLabel = (report: ReadonlyArray<{ arm: ArmSummary }>) =>
  [...new Set(report.map((entry) => entry.arm.excerpts).filter((arm) => arm !== null))].join(', ')

const armName = (noRules: boolean) => (noRules ? 'control' : 'with skills')

export function scoreAll(
  cases: EvalCase[],
  pillars: Pillar[],
  options: Options,
  deps: BenchDeps,
): string {
  const { out, judge, baseline: control } = options
  if (control !== undefined) assertBaseline(cases, pillars, control, deps)
  const report = pillars.map((pillar) => {
    const scores: CaseScore[] = []
    const skillCases: SkillCase[] = []
    const errors: string[] = []
    const tools: boolean[] = []
    const usages: Usage[] = []
    const runUsages: Array<Usage | null> = []
    const arms: Array<ExcerptsMode | null> = []
    const loads: Array<number | null> = []
    for (const item of casesForPillar(cases, pillar)) {
      const result = readCaseResult(item, pillar, out, judge, deps)
      runUsages.push(result.usage)
      arms.push(result.excerpts)
      if (result.usage !== null) usages.push(result.usage)
      if ('error' in result) {
        errors.push(`${item.id}: ${result.error}`)
        continue
      }
      scores.push(result.score)
      loads.push(result.skillLoads)
      tools.push(result.skillTool)
      if (result.skillCase !== null) skillCases.push(result.skillCase)
    }
    const available = tools.length === 0 ? null : tools.some(Boolean)
    const summary = summarizePillar(pillar, scores, skillCases, available, usages)
    if (control !== undefined)
      summary.baseline = compareBaseline(
        skillCases,
        readBaseline(cases, pillar, control, judge, deps),
      )
    const models: ModelReport[] = [summarizeByModel(pillar, armName(options.noRules), runUsages)]
    if (control !== undefined) {
      const controlUsages = casesForPillar(cases, pillar).map(
        (item) => readCaseResult(item, pillar, control, judge, deps).usage,
      )
      models.push(summarizeByModel(pillar, armName(true), controlUsages))
    }
    const arm: ArmSummary = { excerpts: armOf(arms), skillLoads: summarizeLoads(loads) }
    return { summary, scores, skillCases, errors, models, arm }
  })
  // Only an `--excerpts` run records its arm, so a plain run's summary.json and table are unchanged.
  const armed = report.some((entry) => entry.arm.excerpts !== null)
  const saved = report.map(({ arm, ...entry }) => (armed ? { ...entry, ...arm } : entry))
  deps.writeFile(join(out, 'summary.json'), `${JSON.stringify(saved, null, 2)}\n`)
  const errorLines = report.flatMap((entry) =>
    entry.errors.map((line) => `- ${entry.summary.pillar} ${line}`),
  )
  const notes = skillNotes(
    report.map((entry) => ({
      pillar: entry.summary.pillar,
      skills: entry.summary.skills,
      skillCases: entry.skillCases,
    })),
  )
  const controlNotes = baselineNotes(
    report.map((entry) => ({ pillar: entry.summary.pillar, baseline: entry.summary.baseline })),
  )
  const matching = judge === undefined ? 'file and line' : `claims judged by ${judge}`
  const markdown = [
    `Matching: ${matching}.${armed ? ` Excerpts: ${armLabel(report)}.` : ''}`,
    renderSummaryTable(report.map((entry) => entry.summary)),
    'Cost (runs with recorded usage):',
    renderCostTable(report.map((entry) => entry.summary)),
    ...renderArms(report.map((entry) => ({ pillar: entry.summary.pillar, arm: entry.arm }))),
    'Tokens by model (each figure is total / per run; Runs is using the model of covered of expected):',
    renderModelReports(report.flatMap((entry) => entry.models)),
    ...(notes.length > 0 ? ['Skills:', notes.join('\n')] : []),
    ...(controlNotes.length > 0 ? ['Control:', controlNotes.join('\n')] : []),
    ...(errorLines.length > 0 ? ['Errors and skipped runs:', errorLines.join('\n')] : []),
  ].join('\n\n')
  deps.writeFile(join(out, 'summary.md'), `${markdown}\n`)
  return markdown
}

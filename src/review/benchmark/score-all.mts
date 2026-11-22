import { join } from 'node:path'

import type { ExcerptsMode } from '../context/types.mts'
import type { Pillar } from '../pillar-name.mts'
import { casesForPillar, type EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { assertBaseline, baselineNotes, compareBaseline, readBaseline } from './baseline.mts'
import { readCaseResult } from './case-result.mts'
import { renderSummaryTable, summarizePillar, type CaseScore } from './score.mts'
import { readNotes, type ReadCase } from './reads-score.mts'
import { skillNotes, type SkillCase } from './skills-score.mts'
import type { Usage } from './usage.mts'
import { renderModelReports, summarizeByModel, type ModelReport } from './model-usage.mts'
import { armOf, renderArms, summarizeLoads, type ArmSummary } from './excerpts-arm.mts'
import { scoreLoads } from './loads-only.mts'
import { savedEffort } from './effort-option.mts'
import type { BenchEffort } from '../../harness/types.mts'
import { otherHarness } from './harness-option.mts'
import { grantedOnlyPath, onlyPathNote } from './only-path-option.mts'
import { grantedShell, shellNote } from './shell-option.mts'
import { grantedRounds, roundsNote } from './rounds.mts'
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
  /** With `--select`, tell every pillar to load the selected skills, not only `rules`. */
  selectAllPillars?: boolean
  /** `--out` of an earlier `--no-rules` run of the same cases, for the paired control. */
  baseline?: string | undefined
  /** Run each pillar on every selected case and report only the skills it loaded; no judge. */
  loadsOnly?: boolean
  /** The harness that ran the pillar agent; omitted for Claude. */
  harness?: string
  /** Set by `--reads-outside-checkout`. */
  readsOutsideCheckout?: boolean
  /** Set by `--shell`: command prefixes granted to the pillar agent on top of its own. */
  shell?: string[]
  /** Set by `--only-path`: the pillar agent is shown only the diff of these paths. */
  onlyPath?: string[]
  /** Set by `--effort` when not the default `medium`. */
  effort?: BenchEffort
  /** Set by `--rounds` above 1: how many times the pillar agent ran per case. */
  rounds?: number
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
  if (options.loadsOnly === true) return scoreLoads(cases, pillars, out, deps)
  if (control !== undefined) assertBaseline(cases, pillars, control, deps)
  const report = pillars.map((pillar) => {
    const scores: CaseScore[] = []
    const skillCases: SkillCase[] = []
    const readCases: ReadCase[] = []
    const errors: string[] = []
    const tools: boolean[] = []
    const usages: Usage[] = []
    const runUsages: Array<Usage | null> = []
    const arms: Array<ExcerptsMode | null> = []
    const loads: Array<number | null> = []
    const harnesses: Array<string | null> = []
    const shells: Array<string[] | null> = []
    const onlyPaths: Array<string[] | null> = []
    const efforts: Array<BenchEffort | null> = []
    const roundCounts: Array<number | null> = []
    for (const item of casesForPillar(cases, pillar)) {
      const result = readCaseResult(item, pillar, out, judge, deps)
      runUsages.push(result.usage)
      arms.push(result.excerpts)
      harnesses.push(result.harness)
      // A case that was never run records nothing, which is not a different arm.
      if (!('error' in result) || result.error !== 'not run') {
        shells.push(result.shell)
        onlyPaths.push(result.onlyPath)
        efforts.push(result.effort)
        roundCounts.push(result.rounds)
      }
      if (result.usage !== null) usages.push(result.usage)
      if ('error' in result) {
        errors.push(`${item.id}: ${result.error}`)
        continue
      }
      if (result.roundError !== null)
        errors.push(`${item.id}: a later round failed, earlier findings kept: ${result.roundError}`)
      scores.push(result.score)
      loads.push(result.skillLoads)
      tools.push(result.skillTool)
      if (result.skillCase !== null) skillCases.push(result.skillCase)
      if (result.readCase !== null) readCases.push(result.readCase)
    }
    const available = tools.length === 0 ? null : tools.some(Boolean)
    const summary = summarizePillar(pillar, scores, skillCases, available, usages)
    // The flag, else what the saved results record, so a `--score-only` still labels a Codex row.
    const ranOn =
      otherHarness(options.harness) ??
      harnesses.map((name) => otherHarness(name ?? undefined)).find(Boolean)
    if (ranOn !== undefined) summary.harness = ranOn
    const granted = grantedShell(options.shell, shells)
    if (granted !== undefined) summary.shell = granted
    const shown = grantedOnlyPath(options.onlyPath, onlyPaths)
    if (shown !== undefined) summary.onlyPath = shown
    const level = savedEffort(options.effort, efforts)
    if (level !== undefined) summary.effort = level
    const rounded = grantedRounds(options.rounds, roundCounts)
    if (rounded !== undefined) summary.rounds = rounded
    if (control !== undefined)
      summary.baseline = compareBaseline(
        skillCases,
        readBaseline(cases, pillar, control, judge, deps),
      )
    const models: ModelReport[] = [summarizeByModel(pillar, armName(options.noRules), runUsages)]
    if (ranOn !== undefined) models[0] = { ...(models[0] as ModelReport), harness: ranOn }
    if (control !== undefined) {
      const controlUsages = casesForPillar(cases, pillar).map(
        (item) => readCaseResult(item, pillar, control, judge, deps).usage,
      )
      models.push(summarizeByModel(pillar, armName(true), controlUsages))
    }
    const arm: ArmSummary = { excerpts: armOf(arms), skillLoads: summarizeLoads(loads) }
    return { summary, scores, skillCases, readCases, errors, models, arm }
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
  const readLines = readNotes(
    report.map((entry) => ({ pillar: entry.summary.pillar, readCases: entry.readCases })),
  )
  const controlNotes = baselineNotes(
    report.map((entry) => ({ pillar: entry.summary.pillar, baseline: entry.summary.baseline })),
  )
  const ranOn = [...new Set(report.map((entry) => entry.summary.harness).filter(Boolean))]
  const shelled = report.find((entry) => entry.summary.shell !== undefined)?.summary.shell
  const onlyShown = report.find((entry) => entry.summary.onlyPath !== undefined)?.summary.onlyPath
  const levels = [...new Set(report.map((entry) => entry.summary.effort).filter(Boolean))]
  const rounded = [...new Set(report.flatMap((entry) => entry.summary.rounds ?? []))]
  const matching = judge === undefined ? 'file and line' : `claims judged by ${judge}`
  const markdown = [
    ...(ranOn.length === 0
      ? []
      : [
          `Harness: pillar agent on ${ranOn.join(', ')}, model ${options.model}; the judge, selection and verifier stay on Claude. Cost and loaded skills are not reported, so these rows are not comparable with Claude rows.`,
        ]),
    ...(shelled === undefined ? [] : [shellNote(shelled)]),
    ...(onlyShown === undefined ? [] : [onlyPathNote(onlyShown)]),
    ...(levels.length === 0
      ? []
      : [
          `Effort: pillar agent at ${levels.join(', ')}; not what a review uses, so these rows are not comparable with normal rows.`,
        ]),
    ...rounded.map(roundsNote),
    `Matching: ${matching}.${armed ? ` Excerpts: ${armLabel(report)}.` : ''}`,
    renderSummaryTable(report.map((entry) => entry.summary)),
    'Cost (runs with recorded usage):',
    renderCostTable(report.map((entry) => entry.summary)),
    ...renderArms(report.map((entry) => ({ pillar: entry.summary.pillar, arm: entry.arm }))),
    'Tokens by model (each figure is total / per run; Runs is using the model of covered of expected):',
    renderModelReports(report.flatMap((entry) => entry.models)),
    // A harness that reports no loaded skills would list every expected skill as missing.
    ...(notes.length > 0 && ranOn.length === 0 ? ['Skills:', notes.join('\n')] : []),
    ...(readLines.length > 0 ? ['Reads:', readLines.join('\n')] : []),
    ...(controlNotes.length > 0 ? ['Control:', controlNotes.join('\n')] : []),
    ...(errorLines.length > 0 ? ['Errors and skipped runs:', errorLines.join('\n')] : []),
  ].join('\n\n')
  deps.writeFile(join(out, 'summary.md'), `${markdown}\n`)
  return markdown
}

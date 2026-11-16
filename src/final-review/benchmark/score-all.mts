import { join } from 'node:path'

import type { Pillar } from '../finding.mts'
import { casesForPillar, type EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { assertBaseline, baselineNotes, compareBaseline, readBaseline } from './baseline.mts'
import { readCaseResult } from './case-result.mts'
import { renderSummaryTable, summarizePillar, type CaseScore } from './score.mts'
import { skillNotes, type SkillCase } from './skills-score.mts'
import type { Usage } from './usage.mts'
import { renderCostTable } from './usage-summary.mts'

export type Options = {
  out: string
  prompts: string
  model: string
  maxTurns: number
  jobs: number
  scoreOnly: boolean
  judge: string | undefined
  noRules: boolean
  /** `--out` of an earlier `--no-rules` run of the same cases, for the paired control. */
  baseline?: string | undefined
}

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
    for (const item of casesForPillar(cases, pillar)) {
      const result = readCaseResult(item, pillar, out, judge, deps)
      if (result.usage !== null) usages.push(result.usage)
      if ('error' in result) {
        errors.push(`${item.id}: ${result.error}`)
        continue
      }
      scores.push(result.score)
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
    return { summary, scores, skillCases, errors }
  })
  deps.writeFile(join(out, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`)
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
    `Matching: ${matching}.`,
    renderSummaryTable(report.map((entry) => entry.summary)),
    'Cost (runs with recorded usage):',
    renderCostTable(report.map((entry) => entry.summary)),
    ...(notes.length > 0 ? ['Skills:', notes.join('\n')] : []),
    ...(controlNotes.length > 0 ? ['Control:', controlNotes.join('\n')] : []),
    ...(errorLines.length > 0 ? ['Errors and skipped runs:', errorLines.join('\n')] : []),
  ].join('\n\n')
  deps.writeFile(join(out, 'summary.md'), `${markdown}\n`)
  return markdown
}

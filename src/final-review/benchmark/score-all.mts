import { join } from 'node:path'

import type { Pillar } from '../finding.mts'
import { casesForPillar, type EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { currentAssignment, type RawResult } from './judge-all.mts'
import { renderSummaryTable, scoreCase, summarizePillar, type CaseScore } from './score.mts'

export type Options = {
  out: string
  prompts: string
  model: string
  maxTurns: number
  jobs: number
  scoreOnly: boolean
  judge: string | undefined
  clones: string | undefined
  noRules: boolean
}

export function scoreAll(
  cases: EvalCase[],
  pillars: Pillar[],
  options: Options,
  deps: BenchDeps,
): string {
  const { out, judge } = options
  const report = pillars.map((pillar) => {
    const scores: CaseScore[] = []
    const errors: string[] = []
    for (const item of casesForPillar(cases, pillar)) {
      const path = join(out, 'raw', pillar, `${item.id}.json`)
      if (!deps.exists(path)) {
        errors.push(`${item.id}: not run`)
        continue
      }
      const raw = JSON.parse(deps.readFile(path)) as RawResult
      if ('error' in raw) errors.push(`${item.id}: ${raw.error}`)
      else if (judge === undefined) scores.push(scoreCase(item, pillar, raw.findings))
      else {
        const expected = item.expected.filter((entry) => entry.pillar === pillar)
        const assignment = currentAssignment(raw, expected, judge)
        // Unjudged cases stay out of judged metrics rather than falling back to locations.
        if (assignment === undefined) errors.push(`${item.id}: not judged`)
        else scores.push(scoreCase(item, pillar, raw.findings, assignment))
      }
    }
    return { summary: summarizePillar(pillar, scores), scores, errors }
  })
  deps.writeFile(join(out, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`)
  const errorLines = report.flatMap((entry) =>
    entry.errors.map((line) => `- ${entry.summary.pillar} ${line}`),
  )
  const matching = judge === undefined ? 'file and line' : `claims judged by ${judge}`
  const markdown = [
    `Matching: ${matching}.`,
    renderSummaryTable(report.map((entry) => entry.summary)),
    ...(errorLines.length > 0 ? ['Errors and skipped runs:', errorLines.join('\n')] : []),
  ].join('\n\n')
  deps.writeFile(join(out, 'summary.md'), `${markdown}\n`)
  return markdown
}

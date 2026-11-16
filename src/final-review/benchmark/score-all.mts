import { join } from 'node:path'

import type { Pillar } from '../finding.mts'
import { casesForPillar, type EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { currentAssignment, type RawResult } from './judge-all.mts'
import { renderSummaryTable, scoreCase, summarizePillar, type CaseScore } from './score.mts'
import { expectedSkillsFor, scoreSkills, skillNotes, type SkillCase } from './skills-score.mts'

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
  noShared: boolean
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
    const skillCases: SkillCase[] = []
    const errors: string[] = []
    const tools: boolean[] = []
    for (const item of casesForPillar(cases, pillar)) {
      const path = join(out, 'raw', pillar, `${item.id}.json`)
      if (!deps.exists(path)) {
        errors.push(`${item.id}: not run`)
        continue
      }
      const raw = JSON.parse(deps.readFile(path)) as RawResult
      if ('error' in raw) {
        errors.push(`${item.id}: ${raw.error}`)
        continue
      }
      let assignment: ReturnType<typeof currentAssignment>
      if (judge !== undefined) {
        const expected = item.expected.filter((entry) => entry.pillar === pillar)
        assignment = currentAssignment(raw, expected, judge)
        // Unjudged cases stay out of judged metrics rather than falling back to locations.
        if (assignment === undefined) {
          errors.push(`${item.id}: not judged`)
          continue
        }
      }
      const score = scoreCase(item, pillar, raw.findings, assignment)
      scores.push(score)
      tools.push(raw.skillTool !== false)
      const wanted = expectedSkillsFor(item, pillar)
      if (wanted.length > 0) {
        const caught = score.expected > 0 && score.matched === score.expected
        // Results saved before skills were recorded count as nothing loaded.
        skillCases.push(scoreSkills(item, wanted, raw.skills ?? [], caught))
      }
    }
    const available = tools.length === 0 ? null : tools.some(Boolean)
    const summary = summarizePillar(pillar, scores, skillCases, available)
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
  const matching = judge === undefined ? 'file and line' : `claims judged by ${judge}`
  const markdown = [
    `Matching: ${matching}.`,
    renderSummaryTable(report.map((entry) => entry.summary)),
    ...(notes.length > 0 ? ['Skills:', notes.join('\n')] : []),
    ...(errorLines.length > 0 ? ['Errors and skipped runs:', errorLines.join('\n')] : []),
  ].join('\n\n')
  deps.writeFile(join(out, 'summary.md'), `${markdown}\n`)
  return markdown
}

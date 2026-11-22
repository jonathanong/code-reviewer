import { join } from 'node:path'

import type { Pillar } from '../pillar-name.mts'
import { casesForPillar, type EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import type { RawResult } from './judge-all.mts'
import { renderModelReports, summarizeByModel } from './model-usage.mts'
import { skillLabel, skillLoaded, type ExpectedSkill } from './skills-score.mts'
import type { Usage } from './usage.mts'
import { renderCostTable, summarizeUsage } from './usage-summary.mts'

/** The cases a pillar runs on: its own, or every selected case when only skill loads are recorded. */
export function benchCases(
  cases: readonly EvalCase[],
  pillar: Pillar,
  loadsOnly: boolean | undefined,
): EvalCase[] {
  return loadsOnly === true ? [...cases] : casesForPillar(cases, pillar)
}

type Expectation = { id: string; expected: ExpectedSkill[]; missing: ExpectedSkill[] }

function pillarLoads(
  cases: readonly EvalCase[],
  pillar: Pillar,
  out: string,
  deps: Pick<BenchDeps, 'exists' | 'readFile'>,
) {
  const counts = new Map<string, number>()
  const expectations: Expectation[] = []
  const errors: string[] = []
  const usages: Array<Usage | null> = []
  let runs = 0
  let distinct = 0
  for (const item of cases) {
    const path = join(out, 'raw', pillar, `${item.id}.json`)
    if (!deps.exists(path)) {
      errors.push(`${item.id}: not run`)
      usages.push(null)
      continue
    }
    const raw = JSON.parse(deps.readFile(path)) as RawResult
    usages.push(raw.usage ?? null)
    if ('error' in raw) {
      errors.push(`${item.id}: ${raw.error}`)
      continue
    }
    const loaded = raw.skills ?? []
    runs += 1
    distinct += loaded.length
    for (const name of loaded) counts.set(name, (counts.get(name) ?? 0) + 1)
    const expected = item.expectedSkills ?? []
    if (expected.length > 0)
      expectations.push({
        id: item.id,
        expected,
        missing: expected.filter((want) => !skillLoaded(want, loaded)),
      })
  }
  const loads = Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)))
  return {
    pillar,
    runs,
    skillsPerRun: { total: distinct, mean: runs === 0 ? null : distinct / runs },
    loads,
    expectations,
    errors,
    usage: summarizeUsage(usages.filter((usage) => usage !== null)),
    models: summarizeByModel(pillar, 'loads only', usages),
  }
}

/** Skill loads per pillar from saved raw results, with no judge and no recall figures. */
export function scoreLoads(
  cases: readonly EvalCase[],
  pillars: readonly Pillar[],
  out: string,
  deps: BenchDeps,
): string {
  const report = pillars.map((pillar) =>
    pillarLoads(benchCases(cases, pillar, true), pillar, out, deps),
  )
  const saved = report.map(({ models: _models, ...entry }) => ({ mode: 'loads-only', ...entry }))
  deps.writeFile(join(out, 'summary.json'), `${JSON.stringify(saved, null, 2)}\n`)
  const rows = report.map((entry) => {
    const per = entry.skillsPerRun.mean === null ? 'n/a' : entry.skillsPerRun.mean.toFixed(1)
    const met = entry.expectations.filter((item) => item.missing.length === 0).length
    return `| ${entry.pillar} | ${entry.runs} | ${per} | ${Object.keys(entry.loads).length} | ${met} of ${entry.expectations.length} |`
  })
  const loadRows = report.flatMap((entry) =>
    Object.entries(entry.loads).map(
      ([name, count]) => `| ${entry.pillar} | ${name} | ${count} of ${entry.runs} |`,
    ),
  )
  const expectLines = report.flatMap((entry) =>
    entry.expectations.map((item) => {
      const names = item.expected.map(skillLabel).join(', ')
      const missing = item.missing.map(skillLabel).join(', ')
      return `- ${entry.pillar} ${item.id}: ${item.missing.length === 0 ? `loaded ${names}` : `missing ${missing}`}`
    }),
  )
  const errorLines = report.flatMap((entry) =>
    entry.errors.map((line) => `- ${entry.pillar} ${line}`),
  )
  const markdown = [
    'Loads only: no judge, so no recall, severity or false-alarm figures.',
    [
      '| Pillar | Runs | Skills per run | Distinct skills | Cases with every expected skill loaded |',
      '| --- | --- | --- | --- | --- |',
      ...rows,
    ].join('\n'),
    ...(loadRows.length > 0
      ? [
          'Loads per skill (runs that loaded it):',
          ['| Pillar | Skill | Loads |', '| --- | --- | --- |', ...loadRows].join('\n'),
        ]
      : []),
    ...(expectLines.length > 0 ? ['Expected skills:', expectLines.join('\n')] : []),
    'Cost (runs with recorded usage):',
    renderCostTable(report),
    'Tokens by model (each figure is total / per run; Runs is using the model of covered of expected):',
    renderModelReports(report.map((entry) => entry.models)),
    ...(errorLines.length > 0 ? ['Errors and skipped runs:', errorLines.join('\n')] : []),
  ].join('\n\n')
  deps.writeFile(join(out, 'summary.md'), `${markdown}\n`)
  return markdown
}

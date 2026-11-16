import type { SkillChoice } from '../run/types.mts'
import { skillLabel, skillLoaded, type ExpectedSkill } from './skills-score.mts'
import { renderModelTable, summarizeUsage } from './usage-summary.mts'
import type { Usage } from './usage.mts'

export type AttemptScore = {
  attempt: number
  /** Every expected skill (any one of an any-of group) was selected. */
  hit: boolean
  /** Labels of the expected skills the attempt did not select. */
  missed: string[]
  selected: number
}

export type SelectionCaseScore = {
  id: string
  expected: string[]
  /** Attempts that answered; an attempt with an error or no saved file is not scored. */
  attempts: AttemptScore[]
  errors: string[]
  notRun: number[]
}

export type SkillHits = { skill: string; attempts: number; hits: number }

export type SelectionSummary = {
  cases: number
  attempts: number
  hits: number
  hitRate: number | null
  meanSelected: number | null
  errors: number
  notRun: number
  skills: SkillHits[]
}

/** Scores one case's saved attempts (index 0 is attempt 1); `undefined` is an attempt not run. */
export function scoreSelectionCase(
  id: string,
  expected: readonly ExpectedSkill[],
  choices: ReadonlyArray<SkillChoice | undefined>,
): SelectionCaseScore {
  const score: SelectionCaseScore = {
    id,
    expected: expected.map(skillLabel),
    attempts: [],
    errors: [],
    notRun: [],
  }
  choices.forEach((choice, index) => {
    const attempt = index + 1
    if (choice === undefined) score.notRun.push(attempt)
    else if (choice.error !== undefined) score.errors.push(`attempt ${attempt}: ${choice.error}`)
    else {
      const missed = expected.filter((entry) => !skillLoaded(entry, choice.selected))
      score.attempts.push({
        attempt,
        hit: missed.length === 0,
        missed: missed.map(skillLabel),
        selected: choice.selected.length,
      })
    }
  })
  return score
}

export function summarizeSelection(scores: readonly SelectionCaseScore[]): SelectionSummary {
  const attempts = scores.flatMap((score) => score.attempts)
  const hits = attempts.filter((attempt) => attempt.hit).length
  const perSkill = new Map<string, SkillHits>()
  for (const score of scores) {
    for (const skill of score.expected) {
      const total = perSkill.get(skill) ?? { skill, attempts: 0, hits: 0 }
      total.attempts += score.attempts.length
      total.hits += score.attempts.filter((attempt) => !attempt.missed.includes(skill)).length
      perSkill.set(skill, total)
    }
  }
  return {
    cases: scores.length,
    attempts: attempts.length,
    hits,
    hitRate: attempts.length === 0 ? null : hits / attempts.length,
    meanSelected:
      attempts.length === 0
        ? null
        : attempts.reduce((sum, attempt) => sum + attempt.selected, 0) / attempts.length,
    errors: scores.reduce((sum, score) => sum + score.errors.length, 0),
    notRun: scores.reduce((sum, score) => sum + score.notRun.length, 0),
    skills: [...perSkill.values()].sort((a, b) => a.skill.localeCompare(b.skill)),
  }
}

/** Escapes the pipe of an any-of label so it stays inside its table cell. */
const cell = (text: string): string => text.replaceAll('|', '\\|')

function percent(hits: number, total: number): string {
  return total === 0 ? 'n/a' : `${Math.round((100 * hits) / total)}%`
}

function missedCounts(score: SelectionCaseScore): string {
  const counts = new Map<string, number>()
  for (const attempt of score.attempts) {
    for (const skill of attempt.missed) counts.set(skill, (counts.get(skill) ?? 0) + 1)
  }
  return [...counts].map(([skill, n]) => `${skill} x${n}`).join(', ')
}

/** The `summary.md` text: totals, a row per case, a row per expected skill, tokens by model. */
export function renderSelection(
  scores: readonly SelectionCaseScore[],
  summary: SelectionSummary,
  usages: readonly Usage[],
): string {
  const usage = summarizeUsage(usages)
  const mean = summary.meanSelected === null ? 'n/a' : summary.meanSelected.toFixed(1)
  const cost = usage.totalCostUsd === null ? 'n/a' : `$${usage.totalCostUsd.toFixed(2)}`
  const caseRows = scores.map((score) => {
    const hits = score.attempts.filter((attempt) => attempt.hit).length
    const selected = score.attempts.reduce((sum, attempt) => sum + attempt.selected, 0)
    const cells = [
      score.id,
      cell(score.expected.join('; ')),
      `${hits} of ${score.attempts.length}`,
      cell(missedCounts(score)),
      score.attempts.length === 0 ? 'n/a' : (selected / score.attempts.length).toFixed(1),
      String(score.errors.length + score.notRun.length),
    ]
    return `| ${cells.join(' | ')} |`
  })
  const skillRows = summary.skills.map(
    (row) =>
      `| ${cell(row.skill)} | ${row.hits} of ${row.attempts} | ${percent(row.hits, row.attempts)} |`,
  )
  const problems = scores.flatMap((score) => [
    ...score.errors.map((error) => `- ${score.id} ${error}`),
    ...score.notRun.map((attempt) => `- ${score.id} attempt ${attempt}: not run`),
  ])
  return [
    '## Totals',
    [
      `- Cases: ${summary.cases}`,
      `- Attempts scored: ${summary.attempts}`,
      `- Hit rate: ${summary.hits} of ${summary.attempts} (${percent(summary.hits, summary.attempts)})`,
      `- Mean skills selected per attempt: ${mean}`,
      `- Errors: ${summary.errors}; not run: ${summary.notRun}`,
      `- Cost: ${cost}`,
    ].join('\n'),
    '## Per case',
    [
      '| Case | Expected | Hits | Missed | Mean selected | Errors |',
      '| --- | --- | --- | --- | --- | --- |',
      ...caseRows,
    ].join('\n'),
    '## Per expected skill',
    ['| Skill | Hits | Rate |', '| --- | --- | --- |', ...skillRows].join('\n'),
    '## Tokens by model',
    renderModelTable([{ name: 'selection', models: usage.models }], 'Step'),
    ...(problems.length > 0 ? ['## Errors', problems.join('\n')] : []),
  ].join('\n\n')
}

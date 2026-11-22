import type { AttemptScore, SelectionCaseScore } from './selection-score.mts'

/** A case score that declares `unwantedSkills`; its attempts then carry what they selected. */
type Labeled = Omit<SelectionCaseScore, 'attempts' | 'unwanted'> & {
  unwanted: string[]
  attempts: Array<AttemptScore & { unwanted: string[] }>
}

const isLabeled = (score: SelectionCaseScore): score is Labeled => score.unwanted !== undefined

export type UnwantedSkillCount = { skill: string; attempts: number; selected: number }

/** Over-selection over the cases that declare `unwantedSkills`. */
export type UnwantedSummary = {
  cases: number
  /** Scored attempts of those cases. */
  attempts: number
  /** Attempts that selected at least one unwanted skill. */
  attemptsWithUnwanted: number
  /** Unwanted selections in all, counting each skill of an attempt. */
  selections: number
  skills: UnwantedSkillCount[]
}

/** The unwanted skills a selection named. */
export function unwantedSelected(
  unwanted: readonly string[],
  selected: readonly string[],
): string[] {
  return unwanted.filter((skill) => selected.includes(skill))
}

/** Null when no case declares `unwantedSkills`. */
export function summarizeUnwanted(scores: readonly SelectionCaseScore[]): UnwantedSummary | null {
  const labeled = scores.filter(isLabeled)
  if (labeled.length === 0) return null
  const perSkill = new Map<string, UnwantedSkillCount>()
  let attempts = 0
  let attemptsWithUnwanted = 0
  let selections = 0
  for (const score of labeled) {
    attempts += score.attempts.length
    for (const skill of score.unwanted) {
      const total = perSkill.get(skill) ?? { skill, attempts: 0, selected: 0 }
      total.attempts += score.attempts.length
      total.selected += score.attempts.filter((a) => a.unwanted.includes(skill)).length
      perSkill.set(skill, total)
    }
    for (const attempt of score.attempts) {
      const count = attempt.unwanted.length
      selections += count
      if (count > 0) attemptsWithUnwanted += 1
    }
  }
  return {
    cases: labeled.length,
    attempts,
    attemptsWithUnwanted,
    selections,
    skills: [...perSkill.values()].sort((a, b) => a.skill.localeCompare(b.skill)),
  }
}

function percent(hits: number, total: number): string {
  return total === 0 ? 'n/a' : `${Math.round((100 * hits) / total)}%`
}

/** The totals line for `summary.md`. */
export function unwantedTotals(summary: UnwantedSummary): string {
  const { attemptsWithUnwanted: n, attempts: m, selections } = summary
  return `- Unwanted selections: ${n} of ${m} attempts (${percent(n, m)}) named at least one; ${selections} in all`
}

/** The per-case and per-skill sections for `summary.md`. */
export function renderUnwanted(
  scores: readonly SelectionCaseScore[],
  summary: UnwantedSummary,
): string[] {
  const caseRows = scores.filter(isLabeled).map((score) => {
    const counts = score.unwanted.map((skill) => {
      const n = score.attempts.filter((a) => a.unwanted.includes(skill)).length
      return `${skill} x${n}`
    })
    const any = score.attempts.filter((a) => a.unwanted.length > 0).length
    return `| ${score.id} | ${any} of ${score.attempts.length} | ${counts.join(', ')} |`
  })
  const skillRows = summary.skills.map(
    (row) =>
      `| ${row.skill} | ${row.selected} of ${row.attempts} | ${percent(row.selected, row.attempts)} |`,
  )
  return [
    '## Unwanted selections per case',
    ['| Case | Attempts with any | Per skill |', '| --- | --- | --- |', ...caseRows].join('\n'),
    '## Unwanted selections per skill',
    ['| Skill | Selected | Rate |', '| --- | --- | --- |', ...skillRows].join('\n'),
  ]
}

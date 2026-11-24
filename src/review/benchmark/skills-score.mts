import type { Pillar } from '../pillar-name.mts'
import type { EvalCase } from './cases.mts'
import { appliesToPillar } from './pillar-applies.mts'

export type SkillOutcome = 'grounded' | 'ungrounded' | 'loaded-missed' | 'missed'

/** A full `plugin:skill` name, or a non-empty group of which any one satisfies the expectation. */
export type ExpectedSkill = string | string[]

export type SkillCase = {
  id: string
  expectedSkills: ExpectedSkill[]
  /** Expected skills the run did not load. */
  missing: ExpectedSkill[]
  /** Positive cases only: caught with every skill loaded, caught without, or not caught. */
  outcome: SkillOutcome | null
}

export type SkillsSummary = {
  /** False when every run was a control with no Skill tool; null when nothing ran. */
  skillsAvailable: boolean | null
  cases: number
  /** Share of expected skills loaded; null when no case declares any. */
  loaded: number | null
  grounded: number
  ungrounded: number
  loadedMissed: number
  missed: number
  /** Grounded catches over positives that declare expected skills. */
  groundedRecall: number | null
}

/** An expectation is met by a loaded skill with exactly the full name (any one of a group). */
export function skillLoaded(expected: ExpectedSkill, loaded: readonly string[]): boolean {
  const names = typeof expected === 'string' ? [expected] : expected
  return names.some((name) => loaded.includes(name))
}

/** Shows an any-of group as `a | b`. */
export function skillLabel(expected: ExpectedSkill): string {
  return typeof expected === 'string' ? expected : expected.join(' | ')
}

/** The skills a case expects for one pillar: those of its expected pillars; all for a negative. */
export function expectedSkillsFor(item: EvalCase, pillar: Pillar): ExpectedSkill[] {
  return appliesToPillar(item, pillar) ? (item.expectedSkills ?? []) : []
}

function outcome(caught: boolean, missing: readonly ExpectedSkill[]): SkillOutcome {
  if (caught) return missing.length === 0 ? 'grounded' : 'ungrounded'
  return missing.length === 0 ? 'loaded-missed' : 'missed'
}

export function scoreSkills(
  item: EvalCase,
  expectedSkills: ExpectedSkill[],
  loaded: readonly string[],
  caught: boolean,
): SkillCase {
  const missing = expectedSkills.filter((name) => !skillLoaded(name, loaded))
  return {
    id: item.id,
    expectedSkills,
    missing,
    outcome: item.kind === 'positive' ? outcome(caught, missing) : null,
  }
}

export function summarizeSkills(
  scores: readonly SkillCase[],
  skillsAvailable: boolean | null = null,
): SkillsSummary {
  const count = (kind: SkillOutcome) => scores.filter((score) => score.outcome === kind).length
  const total = scores.reduce((sum, score) => sum + score.expectedSkills.length, 0)
  const missing = scores.reduce((sum, score) => sum + score.missing.length, 0)
  const positives = scores.filter((score) => score.outcome !== null).length
  return {
    skillsAvailable,
    cases: scores.length,
    loaded: total === 0 ? null : (total - missing) / total,
    grounded: count('grounded'),
    ungrounded: count('ungrounded'),
    loadedMissed: count('loaded-missed'),
    missed: count('missed'),
    groundedRecall: positives === 0 ? null : count('grounded') / positives,
  }
}

type NoteEntry = { pillar: Pillar; skills: SkillsSummary; skillCases: readonly SkillCase[] }

/** Markdown lines under the table: control note, misses per case, and ungrounded catches. */
export function skillNotes(entries: readonly NoteEntry[]): string[] {
  const lines: string[] = []
  if (entries.some((entry) => entry.skills.skillsAvailable === false))
    lines.push('Control run: no skills available; recall here is the baseline a skill must beat.')
  for (const { pillar, skillCases } of entries) {
    for (const item of skillCases) {
      const names = item.missing.map(skillLabel).join(', ')
      if (item.missing.length > 0) lines.push(`- ${pillar} ${item.id}: missing ${names}`)
      if (item.outcome === 'ungrounded')
        lines.push(`- ${pillar} ${item.id}: caught without ${names}`)
    }
  }
  return lines
}

import type { HistoryCheck } from './context-history.mts'
import type { RulesCheck } from './context-rules.mts'

export type RulesCaseScore = RulesCheck & { id: string }
export type HistoryCaseScore = HistoryCheck & { id: string }

type Tally<K extends string> = Record<K, number>

export type ContextSummary = {
  rules: {
    cases: number
    skills: Tally<'full' | 'part' | 'none' | 'absent'>
    expectedRules: Tally<'present' | 'cut' | 'missing' | 'absent'>
    /** The most characters any one skill quoted, against the per-skill cap. */
    maxQuotedChars: number
    cap: number
    maxSectionChars: number
  }
  history: { cases: number; checks: number; found: number }
}

function count<K extends string>(keys: readonly K[], values: readonly K[]): Tally<K> {
  return Object.fromEntries(
    keys.map((key) => [key, values.filter((value) => value === key).length]),
  ) as Tally<K>
}

export function summarizeContext(
  rules: readonly RulesCaseScore[],
  history: readonly HistoryCaseScore[],
  cap: number,
): ContextSummary {
  const rows = history.flatMap((item) => item.rows)
  return {
    rules: {
      cases: rules.length,
      skills: count(
        ['full', 'part', 'none', 'absent'],
        rules.flatMap((item) => item.skills.map((row) => row.status)),
      ),
      expectedRules: count(
        ['present', 'cut', 'missing', 'absent'],
        rules.flatMap((item) => item.rules.map((row) => row.outcome)),
      ),
      maxQuotedChars: Math.max(
        0,
        ...rules.flatMap((item) => item.skills.map((row) => row.quotedChars)),
      ),
      cap,
      maxSectionChars: Math.max(0, ...rules.map((item) => item.sectionChars)),
    },
    history: {
      cases: history.length,
      checks: rows.length,
      found: rows.filter((row) => row.found).length,
    },
  }
}

const tally = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .map(([key, value]) => `${value} ${key}`)
    .join(', ')

/** The markdown report, also printed as the table. */
export function renderContext(
  rules: readonly RulesCaseScore[],
  history: readonly HistoryCaseScore[],
  summary: ContextSummary,
): string {
  const lines = ['# Context bench', '']
  if (rules.length > 0) {
    lines.push(
      '## Rule excerpts',
      '',
      '| Case | Skills (status, chars quoted) | Rules (present / cut / missing from skill) | Section chars |',
      '| --- | --- | --- | --- |',
    )
    for (const item of rules) {
      const skills = item.skills
        .map((row) => `${row.skill} ${row.status} ${row.quotedChars}`)
        .join('; ')
      const found =
        item.rules.map((row) => `${row.skill} ${row.outcome}`).join('; ') || 'none declared'
      lines.push(`| ${item.id} | ${skills} | ${found} | ${item.sectionChars} |`)
    }
    const { skills, expectedRules, maxQuotedChars, cap, maxSectionChars } = summary.rules
    lines.push(
      '',
      `Skills: ${tally(skills)}. Rules: ${tally(expectedRules)}. Most quoted from one skill: ${maxQuotedChars} of ${cap} characters; largest section ${maxSectionChars}.`,
    )
  }
  if (history.length > 0) {
    lines.push(
      '',
      '## History and linked regressions',
      '',
      '| Case | Check | Found |',
      '| --- | --- | --- |',
    )
    for (const item of history) {
      for (const row of item.rows)
        lines.push(`| ${item.id} | ${row.what} ${row.detail} | ${row.found ? 'yes' : 'NO'} |`)
    }
    lines.push('', `Found ${summary.history.found} of ${summary.history.checks} checks.`)
  }
  return lines.join('\n')
}

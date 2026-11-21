import { join } from 'node:path'

import type { TrackerIo } from '../tracker/types.mts'
import { readOutcomes } from './store.mts'
import { OUTCOMES, type OutcomeRow } from './types.mts'

/** A pillar or rule needs at least this many findings before it is judged. */
export const PROPOSAL_MIN_FINDINGS = 3
/** A group with at least this share of rejected or disputed findings is listed for review. */
export const PROPOSAL_BAD_SHARE = 0.5
/** A rule with at least this many fixed findings and no rejected one is listed as working. */
export const WORKING_MIN_FIXED = 3

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/u
const escape = (text: string) => text.replace(/[[\]|\\<>]/gu, (char) => `\\${char}`)

function tally(rows: readonly OutcomeRow[], by: (row: OutcomeRow) => string | null) {
  const groups = new Map<string, OutcomeRow[]>()
  for (const row of rows) {
    const key = by(row)
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

const count = (rows: readonly OutcomeRow[], outcome: string) =>
  rows.filter((row) => row.outcome === outcome).length

function table(heading: string, groups: [string, OutcomeRow[]][]): string[] {
  if (groups.length === 0) return [`## ${heading}`, '', 'None.', '']
  const head = `| ${heading.replace(/^By /u, '')} | total | ${OUTCOMES.join(' | ')} |`
  const lines = groups.map(
    ([name, rows]) =>
      `| ${escape(name)} | ${rows.length} | ${OUTCOMES.map((outcome) => count(rows, outcome)).join(' | ')} |`,
  )
  return [`## ${heading}`, '', head, `|${' --- |'.repeat(OUTCOMES.length + 2)}`, ...lines, '']
}

const link = (row: OutcomeRow) =>
  `- ${row.outcome}: [${escape(row.title)}](${row.url ?? `https://github.com/${row.repo}/pull/${row.pr}`}) in ${row.repo}#${row.pr}${row.path === null ? '' : ` (\`${row.path}\`)`}`

/** Proposals from fixed thresholds only; no model reads the findings. */
export function proposals(rows: readonly OutcomeRow[]): string[] {
  const lines: string[] = []
  const groups = [
    ['pillar', tally(rows, (row) => row.pillar)],
    ['rule', tally(rows, (row) => row.rule)],
  ] as const
  for (const [kind, entries] of groups) {
    for (const [name, group] of entries) {
      const bad = count(group, 'rejected') + count(group, 'disputed')
      if (group.length >= PROPOSAL_MIN_FINDINGS && bad / group.length >= PROPOSAL_BAD_SHARE) {
        lines.push(
          `- Review this ${kind}/prompt: \`${name}\` (${bad} of ${group.length} rejected or disputed)`,
        )
      }
      const fixed = count(group, 'fixed')
      if (kind === 'rule' && fixed >= WORKING_MIN_FIXED && count(group, 'rejected') === 0) {
        lines.push(`- Working: \`${name}\` (${fixed} fixed, none rejected)`)
      }
    }
  }
  return lines
}

/** The digest's Markdown: titles, paths and links only, never code. */
export function renderDigest(rows: readonly OutcomeRow[], day: string): string {
  const wrong = rows.filter((row) => row.outcome === 'rejected' || row.outcome === 'disputed')
  const found = proposals(rows)
  return [
    `# Review outcomes ${day}`,
    '',
    `${rows.length} findings recorded. "ignored" is reported, never counted as wrong.`,
    '',
    ...table(
      'By outcome',
      tally(rows, (row) => row.outcome),
    ),
    ...table(
      'By pillar',
      tally(rows, (row) => row.pillar),
    ),
    ...table(
      'By severity',
      tally(rows, (row) => row.severity),
    ),
    ...table(
      'By rule skill',
      tally(rows, (row) => row.rule),
    ),
    '## Rejected and disputed',
    '',
    ...(wrong.length === 0 ? ['None.'] : wrong.map(link)),
    '',
    '## Proposals',
    '',
    ...(found.length === 0 ? ['None.'] : found),
    '',
  ].join('\n')
}

/** Writes `outcomes-DAY.md` from the stored rows into `out` (default: beside the rows). */
export function writeDigest(io: TrackerIo, day: string, out: string | undefined): string {
  if (!DAY_RE.test(day)) throw new Error('--day must be YYYY-MM-DD.')
  const path = join(out ?? io.dir, `outcomes-${day}.md`)
  io.write(path, renderDigest(readOutcomes(io), day))
  return path
}

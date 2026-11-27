import { join } from 'node:path'

import type { TrackerIo } from '../tracker/types.mts'
import { readMisses, readOutcomes } from './store.mts'
import { count, escape, tally } from './group.mts'
import { findProposals } from './propose.mts'
import { OUTCOMES, type MissRow, type OutcomeRow } from './types.mts'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/u
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

const missLine = (row: MissRow) =>
  `- ${escape(row.reviewer)}: [${escape(row.summary)}](${row.url ?? `https://github.com/${row.repo}/pull/${row.pr}`}) in ${row.repo}#${row.pr}${row.path === null ? '' : ` (\`${row.path}${row.line === null ? '' : `:${row.line}`}\`)`}`

/** Proposals from fixed thresholds only; no model reads the findings. */
export function proposals(rows: readonly OutcomeRow[]): string[] {
  return findProposals(rows).map((found) =>
    found.kind === 'review'
      ? `- Review this ${found.scope}/prompt: \`${found.name}\` (${found.bad} of ${found.rows.length} rejected or disputed)`
      : `- Working: \`${found.name}\` (${found.fixed} fixed, none rejected)`,
  )
}

/** The digest's Markdown: titles, paths and links only, never code. */
export function renderDigest(
  rows: readonly OutcomeRow[],
  day: string,
  misses: readonly MissRow[] = [],
): string {
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
    '## Caught by others, not by us (candidates)',
    '',
    `${misses.length} candidates: another reviewer's thread whose lines a later commit changed, with none of our findings nearby. A heuristic, not confirmed misses; triage each.`,
    '',
    ...misses.map(missLine),
    ...(misses.length === 0 ? [] : ['']),
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
  io.write(path, renderDigest(readOutcomes(io), day, readMisses(io)))
  return path
}

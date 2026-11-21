import { escape } from '../outcomes/group.mts'
import { findProposals } from '../outcomes/propose.mts'
import { OUTCOMES, type OutcomeRow } from '../outcomes/types.mts'
import { REVIEWER_TARGET } from './config-parse.mts'

/** Evidence links listed in one issue body; the rest are counted. */
export const MAX_EVIDENCE = 10

export type IssueProposal = {
  /** Stable across runs, so the same proposal is never filed twice. */
  key: string
  /** A rule plugin name, or `code-reviewer`. */
  target: string
  title: string
  body: string
}

/** The hidden last line of a body, which a later run searches for. */
export const markerOf = (key: string) => `<!-- code-reviewer:issue ${key} -->`

const oneLine = (text: string) => text.replace(/\s+/gu, ' ').trim()

const evidenceLine = (row: OutcomeRow) =>
  `- ${row.outcome}: [${escape(oneLine(row.title))}](${row.url ?? `https://github.com/${row.repo}/pull/${row.pr}`}) in ${row.repo}#${row.pr}`

/**
 * The body is built only from outcome counts and the finding titles and links of rejected or
 * disputed findings: no code, paths or comment text reach it.
 */
function bodyOf(subject: string, advice: string, rows: readonly OutcomeRow[], key: string) {
  const counts = OUTCOMES.flatMap((outcome) => {
    const n = rows.filter((row) => row.outcome === outcome).length
    return n === 0 ? [] : [`${outcome} ${n}`]
  })
  const evidence = rows.filter((row) => row.outcome === 'rejected' || row.outcome === 'disputed')
  const more = evidence.length - MAX_EVIDENCE
  return [
    `The code reviewer posted ${rows.length} findings attributed to ${subject}. Outcomes: ${counts.join(', ')}.`,
    '',
    'Evidence (rejected or disputed findings):',
    '',
    ...evidence.slice(0, MAX_EVIDENCE).map(evidenceLine),
    ...(more > 0 ? [`- and ${more} more`] : []),
    '',
    `Proposed: ${advice}`,
    '',
    markerOf(key),
    '',
  ].join('\n')
}

/**
 * One proposal for each rule or pillar that is mostly rejected or disputed. A rule belongs to its
 * plugin's target; a pillar belongs to the reviewer. "Working" groups propose nothing.
 */
export function issueProposals(rows: readonly OutcomeRow[]): IssueProposal[] {
  return findProposals(rows)
    .filter((found) => found.kind === 'review')
    .map((found) => {
      const share = `${found.bad} of ${found.rows.length} findings rejected or disputed`
      if (found.scope === 'pillar') {
        const key = `pillar:${found.name}:review`
        const subject = `the \`${found.name}\` pillar`
        const advice = "review this pillar's prompt for the cases above."
        return {
          key,
          target: REVIEWER_TARGET,
          title: `Review the ${found.name} pillar prompt: ${share}`,
          body: bodyOf(subject, advice, found.rows, key),
        }
      }
      const split = found.name.indexOf(':')
      const plugin = split === -1 ? found.name : found.name.slice(0, split)
      const skill = split === -1 ? found.name : found.name.slice(split + 1)
      const key = `rule:${plugin}:${skill}:review`
      const subject = `the rule \`${found.name}\``
      const advice = "review the rule's wording and scope for the cases above."
      return {
        key,
        target: plugin,
        title: `Review rule ${found.name}: ${share}`,
        body: bodyOf(subject, advice, found.rows, key),
      }
    })
}

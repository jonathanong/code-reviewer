import type { FollowUpContext } from '../context.mts'
import { renderFollowUpContext } from '../context-render.mts'
import type { Finding } from '../finding.mts'
import { asFinding, bodyLines } from '../run/body-carry.mts'
import { contextFileLine, sinceFileLine } from '../run/pillar-prompt.mts'
import { FIXED_THREADS_LINES, previousLines } from '../run/previous-prompt.mts'
import type { FollowUpCase } from './followup-case.mts'

/**
 * The follow-up blocks of the verifier prompt, from the builders a live follow-up uses: the earlier
 * review and its held evidence, the files it reads, and the `fixedThreadIds` instruction.
 */
export function followUpLines(followUp: FollowUpCase, out: string, first = 0): string[] {
  const bodies = followUp.bodyFindings ?? []
  return [
    ...previousLines(followUp.previous, followUp.held ?? []),
    contextFileLine(out),
    sinceFileLine(out, followUp.previous.sha),
    ...FIXED_THREADS_LINES,
    ...bodyLines(
      bodies.length === 0 ? undefined : { sha: followUp.previous.sha, first, count: bodies.length },
    ),
  ]
}

/** The case's earlier findings with no thread as the input findings a live run appends after the others. */
export function followUpBodyInputs(followUp: FollowUpCase | undefined): Finding[] {
  // `parseFollowUp` has already checked that each one reads as a finding.
  return (followUp?.bodyFindings ?? []).map((entry) => asFinding(entry) as Finding)
}

/** `context.md` as a live follow-up renders it, so the verifier sees the unresolved threads with their ids. */
export function followUpContextText(
  followUp: FollowUpCase,
  title: string,
  description: string,
): string {
  const { previous } = followUp
  const context: FollowUpContext = {
    title,
    author: 'author',
    intent: { body: description, issues: [] },
    headSha: 'head',
    baseSha: 'base',
    lines: 0,
    reviewedSha: previous.sha,
    verdict: previous.verdict,
    effort: previous.mode,
    commitsSince: ['Address review comments'],
    unread: { threads: 0, ownReview: false },
    olderSkipped: false,
    unresolved: [...followUp.unresolved, ...(followUp.bodyFindings ?? [])],
    priorQuestions: [],
    others: [],
    othersDropped: 0,
    restatable: [],
    answerable: [],
  }
  return renderFollowUpContext(context)
}

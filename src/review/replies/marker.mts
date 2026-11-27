import { SEVERITIES, type Severity } from '../finding.mts'

export const REPLY_STATES = ['settled', 'downgraded', 'open'] as const
export type ReplyState = (typeof REPLY_STATES)[number]

const MARKER_RE = new RegExp(
  `<!-- final-review-reply state=(${REPLY_STATES.join('|')})(?: severity=(${SEVERITIES.join('|')}))? -->`,
  'u',
)

/** Hidden marker on this reviewer's reply to an author's reply: what it judged, and the severity it left. */
export function replyMarker(state: ReplyState, severity?: Severity): string {
  return `<!-- final-review-reply state=${state}${severity === undefined ? '' : ` severity=${severity}`} -->`
}

/** What a comment's marker says; undefined when it has none. Read it only on a comment by the trusted identity. */
export function parseReplyMarker(
  body: string,
): { state: ReplyState; severity?: Severity } | undefined {
  const found = MARKER_RE.exec(body)
  if (found === null) return undefined
  const severity = SEVERITIES.find((candidate) => candidate === found[2])
  return {
    state: found[1] as ReplyState,
    ...(severity === undefined ? {} : { severity }),
  }
}

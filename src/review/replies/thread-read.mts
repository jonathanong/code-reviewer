import type { ReviewThread } from '../context-query.mts'
import { SEVERITIES, type Severity } from '../finding.mts'
import { isTrustedAuthor } from '../trust.mts'
import { parseReplyMarker } from './marker.mts'

/** Replies shown for each thread: the call stays small. */
export const MAX_REPLIES = 5
export const FINDING_CHARS = 2000
const REPLY_CHARS = 1500

/** One of the author's new replies, flattened and cut; untrusted. */
export type AuthorReply = { url?: string | undefined; text: string }

const rank = (severity: Severity) => SEVERITIES.indexOf(severity)

export function flat(text: string, max: number): string {
  const clean = text
    .replaceAll(/<!--[\s\S]*?-->/gu, '')
    .replaceAll(/\s+/gu, ' ')
    .trim()
  return clean.length > max ? `${clean.slice(0, max)} [cut]` : clean
}

const sameLogin = (a: string | undefined, b: string): boolean =>
  a !== undefined && a.toLowerCase().replace(/\[bot\]$/u, '') === b.toLowerCase()

/** The severity this reviewer's last downgrade marker in the thread left, when it is below the posted one. */
export function standingSeverity(
  thread: ReviewThread | undefined,
  posted: Severity,
  trusted: ReadonlySet<string>,
): Severity {
  const lowered = (thread?.comments.nodes ?? [])
    .slice(1)
    .filter((comment) => isTrustedAuthor(comment.author?.login, trusted))
    .map((comment) => parseReplyMarker(comment.body))
    .findLast((marker) => marker?.state === 'downgraded')
  return lowered?.severity !== undefined && rank(lowered.severity) > rank(posted)
    ? lowered.severity
    : posted
}

/** The author's replies after this reviewer last spoke in the thread, oldest first. */
export function newReplies(
  thread: ReviewThread,
  author: string,
  trusted: ReadonlySet<string>,
): AuthorReply[] {
  const { nodes } = thread.comments
  const lastOwn = nodes.findLastIndex((comment) => isTrustedAuthor(comment.author?.login, trusted))
  return nodes
    .slice(Math.max(lastOwn, 0) + 1)
    .filter((comment) => comment.isMinimized !== true && sameLogin(comment.author?.login, author))
    .slice(-MAX_REPLIES)
    .map((comment) => ({ url: comment.url, text: flat(comment.body, REPLY_CHARS) }))
}

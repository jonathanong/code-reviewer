import { buildFollowUpContext, type PriorFinding } from '../context.mts'
import type { PrConversation, ReviewThread } from '../context-query.mts'
import { SEVERITIES, type Severity } from '../finding.mts'
import { latestInstance } from '../last-review.mts'
import { MARKER_RE } from '../markers.mts'
import type { Question } from '../question.mts'
import { VERDICTS, type Verdict } from '../render.mts'
import { APPROVAL_CHECK } from '../skipped.mts'
import { isTrustedAuthor } from '../trust.mts'
import { parseReplyMarker } from './marker.mts'

/** Threads judged in one call, and replies shown for each: the call stays small. */
export const MAX_CANDIDATES = 10
export const MAX_REPLIES = 5
const FINDING_CHARS = 2000
const REPLY_CHARS = 1500

/** One of the author's new replies, flattened and cut; untrusted. */
export type AuthorReply = { url?: string | undefined; text: string }

/** An earlier finding with new author replies, as the judging call sees it. */
export type ReplyCandidate = {
  thread: string
  /** The severity the finding stands at now: its posted one, or the one this reviewer lowered it to. */
  severity: Severity
  pillar: string
  title: string
  path: string | null
  line: number | null
  /** The start of the finding's own comment, which says what would settle it. */
  finding: string
  replies: AuthorReply[]
}

/** An earlier finding still open; it counts toward the verdict. */
export type StandingFinding = {
  /** Null for a finding in the review body, which has no thread. */
  thread: string | null
  severity: Severity
  pillar: string
  title: string
  path: string | null
  line: number | null
}

export type ReplyPlan = {
  headSha: string
  author: string
  effort: string
  /** The verdict of the newest review of this head by this reviewer. */
  posted: Verdict
  questions: Question[]
  /** The newest review lists the approval check as skipped, which keeps its verdict a Comment. */
  approvalSkipped: boolean
  standing: StandingFinding[]
  candidates: ReplyCandidate[]
  /** Threads with new replies that were not judged, each with why. */
  unjudged: { thread: string; why: string }[]
}

export type NoPlan = { noop: string }

const rank = (severity: Severity) => SEVERITIES.indexOf(severity)

function flat(text: string, max: number): string {
  const clean = text
    .replaceAll(/<!--[\s\S]*?-->/gu, '')
    .replaceAll(/\s+/gu, ' ')
    .trim()
  return clean.length > max ? `${clean.slice(0, max)} [cut]` : clean
}

const sameLogin = (a: string | undefined, b: string): boolean =>
  a !== undefined && a.toLowerCase().replace(/\[bot\]$/u, '') === b.toLowerCase()

/** The severity this reviewer's last downgrade marker in the thread left, when it is below the posted one. */
function standingSeverity(
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
function newReplies(
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

function verdictOf(raw: string | null): Verdict | undefined {
  return VERDICTS.find((verdict) => verdict === raw?.replace('-', ' '))
}

/**
 * Reads what a reply-only re-assessment needs from the pull request: the newest review of this
 * reviewer, the earlier findings still open at their current severity, and the author's replies
 * that came after this reviewer last spoke in each thread. Nothing here is a model call or a write.
 * It returns a reason instead of a plan when the pull request is not one this applies to: the head
 * moved since that review (a follow-up review reads the replies then), no review of this head
 * exists, the author is the reviewer's own identity, or no thread has a new author reply.
 */
export function planReplies(
  pull: PrConversation,
  trusted: ReadonlySet<string>,
): ReplyPlan | NoPlan {
  const context = buildFollowUpContext(pull, trusted)
  const own = pull.reviews.nodes.filter((review) => isTrustedAuthor(review.author?.login, trusted))
  const newest = own.map((review) => MARKER_RE.exec(review.body)).findLast((m) => m !== null)
  if (newest === undefined || newest[2] === 'Skipped' || context.reviewedSha === null) {
    return { noop: 'this reviewer has no review of this pull request to re-assess' }
  }
  if (context.reviewedSha !== context.headSha || newest[1] !== context.headSha) {
    return {
      noop: `the head moved since the last review (${context.reviewedSha.slice(0, 12)}); a follow-up review reads the replies`,
    }
  }
  const posted = verdictOf(context.verdict)
  if (posted === undefined) return { noop: 'the last review carries a verdict this cannot read' }
  if (context.author === null) return { noop: 'the pull request author is unknown' }
  if (isTrustedAuthor(context.author, trusted)) {
    return { noop: "the pull request author is this reviewer's own identity" }
  }
  const threads = new Map(pull.reviewThreads.nodes.map((thread) => [thread.id, thread]))
  const standing: StandingFinding[] = []
  const candidates: ReplyCandidate[] = []
  const unjudged: ReplyPlan['unjudged'] = []
  for (const prior of context.unresolved) {
    const thread = threads.get(String(prior.threadId))
    const severity = standingSeverity(thread, prior.severity as Severity, trusted)
    standing.push(entry(prior, severity))
    if (thread === undefined) continue
    const replies = newReplies(thread, context.author, trusted)
    if (replies.length === 0) continue
    const { nodes, totalCount } = thread.comments
    if (totalCount !== undefined && totalCount > nodes.length) {
      unjudged.push({ thread: thread.id, why: 'the thread is longer than what was read' })
    } else if (candidates.length >= MAX_CANDIDATES) {
      unjudged.push({
        thread: thread.id,
        why: `more than ${MAX_CANDIDATES} threads have new replies`,
      })
    } else {
      candidates.push({
        thread: thread.id,
        severity,
        pillar: prior.pillar,
        title: prior.title,
        path: prior.path,
        line: prior.line,
        finding: nodes
          .slice(0, 1)
          .map((first) => flat(first.body, FINDING_CHARS))
          .join(''),
        replies,
      })
    }
  }
  if (candidates.length === 0)
    return { noop: 'no thread has a new reply by the pull request author' }
  const instance = latestInstance(own, context.reviewedSha)
  return {
    headSha: context.headSha,
    author: context.author,
    effort: String(context.effort),
    posted,
    questions: context.priorQuestions,
    approvalSkipped: instance.some((review) => review.body.includes(`**${APPROVAL_CHECK}**`)),
    standing,
    candidates,
    unjudged,
  }
}

function entry(prior: PriorFinding, severity: Severity): StandingFinding {
  return {
    thread: prior.threadId,
    severity,
    pillar: prior.pillar,
    title: prior.title,
    path: prior.path,
    line: prior.line,
  }
}

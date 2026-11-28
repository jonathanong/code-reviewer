import { buildFollowUpContext, type PriorFinding } from '../context.mts'
import type { PrConversation } from '../context-query.mts'
import type { Severity } from '../finding.mts'
import { latestInstance } from '../last-review.mts'
import { MARKER_RE } from '../markers.mts'
import type { Question } from '../question.mts'
import { VERDICTS, type Verdict } from '../render.mts'
import { APPROVAL_CHECK } from '../skipped.mts'
import { isTrustedAuthor } from '../trust.mts'
import {
  flat,
  FINDING_CHARS,
  newReplies,
  standingSeverity,
  type AuthorReply,
} from './thread-read.mts'

export const MAX_CANDIDATES = 10

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
  /**
   * Set only when the head moved since the review: the git diff of the finding's file from the
   * reviewed commit to the current head, which the author's reply may be about. Untrusted code.
   */
  sinceDiff?: string
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
  /**
   * The head the newest review covers. When it differs from `headSha` the head moved since that
   * review; see `headMoved`.
   */
  reviewedSha: string
  /** The newest review by this reviewer when the plan was read; a different one later means another run wrote. */
  reviewId: string
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
  /**
   * Open review threads that were not read, or whose review was not read. One may hold a finding of
   * this reviewer missing from `standing`, so a plan with any never changes the verdict.
   */
  unreadThreads: number
}

export type NoPlan = { noop: string }

/**
 * True when the head moved since the review this plan re-assesses. Those new commits were never
 * reviewed as a whole, so such a plan may reply in threads and resolve them but never changes the
 * verdict, approves, or touches the labels: only a follow-up review gives a verdict on the new head.
 */
export const headMoved = (plan: Pick<ReplyPlan, 'headSha' | 'reviewedSha'>): boolean =>
  plan.headSha !== plan.reviewedSha

/** The id of the newest review by this reviewer, of any kind; undefined when it has none. */
export function newestOwnReview(
  pull: PrConversation,
  trusted: ReadonlySet<string>,
): string | undefined {
  return pull.reviews.nodes.findLast((review) => isTrustedAuthor(review.author?.login, trusted))?.id
}

function verdictOf(raw: string | null): Verdict | undefined {
  return VERDICTS.find((verdict) => verdict === raw?.replace('-', ' '))
}

/**
 * Reads what a reply-only re-assessment needs from the pull request: the newest review of this
 * reviewer, the earlier findings still open at their current severity, and the author's replies
 * that came after this reviewer last spoke in each thread. Nothing here is a model call or a write.
 * When the head moved since that review, a thread with a new author reply is still a candidate (the
 * reply often says "fixed in <sha>"); the caller adds the diff since the reviewed commit, and the
 * plan is `headMoved`, so it applies to threads only. It returns a reason instead of a plan when the
 * pull request is not one this applies to: this reviewer has no review of it, the author is the
 * reviewer's own identity, or no thread has a new author reply.
 */
export function planReplies(
  pull: PrConversation,
  trusted: ReadonlySet<string>,
): ReplyPlan | NoPlan {
  const context = buildFollowUpContext(pull, trusted)
  const own = pull.reviews.nodes.filter((review) => isTrustedAuthor(review.author?.login, trusted))
  const newest = own.map((review) => MARKER_RE.exec(review.body)).findLast((m) => m !== null)
  if (newest === undefined && pull.reviews.pageInfo?.hasPreviousPage === true) {
    return {
      noop: 'this reviewer has no review among the newest reviews read; older ones were not read',
    }
  }
  if (newest === undefined || newest[2] === 'Skipped' || context.reviewedSha === null) {
    return { noop: 'this reviewer has no review of this pull request to re-assess' }
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
    reviewedSha: context.reviewedSha,
    reviewId: newestOwnReview(pull, trusted) as string,
    author: context.author,
    effort: String(context.effort),
    posted,
    questions: context.priorQuestions,
    approvalSkipped: instance.some((review) => review.body.includes(`**${APPROVAL_CHECK}**`)),
    standing,
    candidates,
    unjudged,
    unreadThreads: pull.reviewThreads.unread ?? 0,
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

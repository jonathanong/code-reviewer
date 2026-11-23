import type { PrConversation, ReviewThread } from './context-query.mts'
import { parseBodyFindings } from './body-findings.mts'
import { parseInlineHead } from './finding-head.mts'
import { answerableThreads, type Answerable } from './context/answerable.mts'
import { restatableThreads, type Restatable } from './context/restatable.mts'
import { othersFrom, type OtherNote } from './context/others.mts'
import { latestInstance } from './last-review.mts'
import { MARKER_RE, PART_MARKER_RE } from './markers.mts'
import { parseQuestions, type Question } from './question.mts'
import { isTrustedAuthor } from './trust.mts'

export type PriorFinding = {
  /** Null for a finding posted in the review body, which has no thread to resolve. */
  threadId: string | null
  severity: string
  pillar: string
  title: string
  path: string | null
  line: number | null
  outdated: boolean
}

export type FollowUpContext = {
  title: string
  /** Login of the pull request author; null when the account is gone. */
  author: string | null
  /** The pull request description and closing issues: untrusted, truncated. */
  intent: { body: string; issues: { number: number; title: string; body: string }[] }
  headSha: string
  baseSha: string
  lines: number
  reviewedSha: string | null
  verdict: string | null
  effort: string | null
  /** Headlines of commits after the reviewed SHA; null when it is not in the recent history. */
  commitsSince: string[] | null
  /** The conversation exceeded one query page, so older reviews or threads may be missing. */
  truncated: boolean
  unresolved: PriorFinding[]
  /** Questions the last review asked, so a follow-up does not ask an answered one again. */
  priorQuestions: Question[]
  others: OtherNote[]
  /** Older notes of other reviewers cut by the cap, so the verifier knows the list is partial. */
  othersDropped: number
  /** Open blocking or high threads of other reviewers, which the verifier may restate. */
  restatable: Restatable[]
  /** Open threads of other reviewers this one has not spoken in; the verifier may answer them. */
  answerable: Answerable[]
}

const BODY_CHARS = 24_000
const ISSUE_BODY_CHARS = 1500

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
function priorFinding(thread: ReviewThread, body: string): PriorFinding | undefined {
  const head = parseInlineHead(body)
  if (head === undefined) return undefined
  return {
    threadId: thread.id,
    ...head,
    path: thread.path,
    line: thread.line,
    outdated: thread.isOutdated,
  }
}

/** Distills a pull request's review conversation into what a follow-up review needs. */
export function buildFollowUpContext(
  pull: PrConversation,
  trusted: ReadonlySet<string>,
): FollowUpContext {
  // Only the posting identity's markers count: anyone else could forge one.
  const own = pull.reviews.nodes.filter((review) => isTrustedAuthor(review.author?.login, trusted))
  const markedReviews = own.filter(
    (review) => MARKER_RE.test(review.body) || PART_MARKER_RE.test(review.body),
  )
  // A skip notice reviewed nothing, so it is not a prior review: the next review is a first one.
  const latest = own
    .map((review) => MARKER_RE.exec(review.body))
    .filter((match) => match !== null && match[2] !== 'Skipped')
    .at(-1)
  const reviewedSha = latest?.[1] ?? null
  const oids = pull.commits.nodes.map((node) => node.commit.oid)
  const index = reviewedSha === null ? -1 : oids.indexOf(reviewedSha)
  const markedIds = new Set(markedReviews.map((review) => review.id))
  const unresolved = pull.reviewThreads.nodes.flatMap((thread) => {
    const first = thread.comments.nodes[0]
    if (thread.isResolved || first === undefined) return []
    if (!markedIds.has(first.pullRequestReview?.id ?? '')) return []
    return priorFinding(thread, first.body) ?? []
  })
  const others = othersFrom(pull, markedIds, trusted)
  const lastReviews = latestInstance(own, latest?.[1])
  const bodyFindings = lastReviews.flatMap((review) => parseBodyFindings(review.body))
  return {
    title: pull.title,
    author: pull.author?.login ?? null,
    intent: {
      body: clip(pull.body, BODY_CHARS),
      issues: pull.closingIssuesReferences.nodes.map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: clip(issue.body, ISSUE_BODY_CHARS),
      })),
    },
    headSha: pull.headRefOid,
    baseSha: pull.baseRefOid,
    lines: pull.additions + pull.deletions,
    reviewedSha,
    verdict: latest?.[2] ?? null,
    effort: latest?.[3] ?? null,
    commitsSince:
      index === -1
        ? null
        : pull.commits.nodes.slice(index + 1).map((node) => node.commit.messageHeadline),
    truncated:
      pull.reviews.pageInfo?.hasPreviousPage === true ||
      pull.reviewThreads.pageInfo?.hasPreviousPage === true,
    unresolved: [...unresolved, ...bodyFindings],
    priorQuestions: lastReviews.flatMap((review) => parseQuestions(review.body)),
    others: others.notes,
    othersDropped: others.dropped,
    restatable: restatableThreads(pull, trusted),
    answerable: answerableThreads(pull, trusted),
  }
}

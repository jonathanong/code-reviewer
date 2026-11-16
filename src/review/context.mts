import type { PrConversation, ReviewThread } from './context-query.mts'
import { parseBodyFindings } from './body-findings.mts'
import { MARKER_RE, PART_MARKER_RE } from './post.mts'
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

export type OtherNote = { author: string; where: string; text: string }

export type FollowUpContext = {
  title: string
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
  others: OtherNote[]
}

const FINDING_RE = /^\*\*\[(blocking|high|medium|low)\]\*\* (.+)\n\n<sub>([a-z-]+)<\/sub>/u
const NOTE_CHARS = 360
const BODY_CHARS = 4000
const ISSUE_BODY_CHARS = 1500

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
/** Bots whose comments never carry review content. */
const NOISE_AUTHORS = new Set(['codecov', 'github-actions', 'dependabot', 'vercel', 'netlify'])
/** Service failure notices only: a reviewer saying an endpoint lacks a rate limit is feedback. */
const NOISE_TEXT_RE =
  /hit your usage limits?|usage limits? (?:reached|exceeded)|rate[- ]limit(?:ed| (?:exceeded|reached|hit))\b|review limit reached|review (?:summary|failed)[^.]*failed|review paused/iu

function isNoise(note: OtherNote): boolean {
  return NOISE_AUTHORS.has(note.author.replace(/\[bot\]$/u, '')) || NOISE_TEXT_RE.test(note.text)
}
const MAX_OTHER_NOTES = 40

/** Collapses a third-party comment to plain text: no HTML comments, collapsed details, bounded. */
export function squash(body: string, max = NOTE_CHARS): string {
  const text = body
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<details>\s*<summary>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/gu, ' [$1] ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function login(author: { login: string } | null): string {
  return author?.login ?? 'ghost'
}

function priorFinding(thread: ReviewThread, body: string): PriorFinding | undefined {
  const match = FINDING_RE.exec(body)
  if (match === null) return undefined
  return {
    threadId: thread.id,
    severity: match[1] as string,
    title: match[2] as string,
    pillar: match[3] as string,
    path: thread.path,
    line: thread.line,
    outdated: thread.isOutdated,
  }
}

type Dated = OtherNote & { at: string }

function othersFrom(pull: PrConversation, finalIds: Set<string>): OtherNote[] {
  const threads = pull.reviewThreads.nodes.flatMap((thread): Dated[] => {
    const first = thread.comments.nodes[0]
    if (thread.isResolved || first === undefined) return []
    if (finalIds.has(first.pullRequestReview?.id ?? '')) return []
    const where = `${thread.path}:${thread.line ?? 'file'}${thread.isOutdated ? ' (outdated)' : ''}`
    return [{ author: login(first.author), where, text: squash(first.body), at: first.createdAt }]
  })
  const reviews = pull.reviews.nodes.flatMap((review): Dated[] => {
    if (finalIds.has(review.id) || review.body.trim().length === 0) return []
    const where = `review ${review.state.toLowerCase()} @${review.commit?.oid.slice(0, 7) ?? '?'}`
    return [
      {
        author: login(review.author),
        where,
        text: squash(review.body),
        at: review.submittedAt ?? '',
      },
    ]
  })
  const comments = pull.comments.nodes.flatMap((comment): Dated[] =>
    comment.body.trim().length === 0
      ? []
      : [
          {
            author: login(comment.author),
            where: 'comment',
            text: squash(comment.body),
            at: comment.createdAt,
          },
        ],
  )
  // Oldest first, so the cap keeps the newest notes whichever source they came from.
  return [...threads, ...reviews, ...comments]
    .filter((note) => !isNoise(note))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-MAX_OTHER_NOTES)
    .map(({ author, where, text }) => ({ author, where, text }))
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
  const latest = own
    .map((review) => MARKER_RE.exec(review.body))
    .filter((match) => match !== null)
    .at(-1)
  const reviewedSha = latest?.[1] ?? null
  const oids = pull.commits.nodes.map((node) => node.commit.oid)
  const index = reviewedSha === null ? -1 : oids.indexOf(reviewedSha)
  const finalIds = new Set(markedReviews.map((review) => review.id))
  const unresolved = pull.reviewThreads.nodes.flatMap((thread) => {
    const first = thread.comments.nodes[0]
    if (thread.isResolved || first === undefined) return []
    if (!finalIds.has(first.pullRequestReview?.id ?? '')) return []
    return priorFinding(thread, first.body) ?? []
  })
  const latestSha = latest?.[1]
  const bodyFindings = own
    .filter((review) =>
      [MARKER_RE, PART_MARKER_RE].some((re) => re.exec(review.body)?.[1] === latestSha),
    )
    .flatMap((review) => parseBodyFindings(review.body))
  return {
    title: pull.title,
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
    others: othersFrom(pull, finalIds),
  }
}

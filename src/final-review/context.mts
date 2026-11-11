import type { PrConversation, ReviewThread } from './context-query.mts'
import { MARKER_RE, PART_MARKER_RE } from './post.mts'

export type PriorFinding = {
  threadId: string
  severity: string
  pillar: string
  title: string
  path: string
  line: number | null
  outdated: boolean
}

export type OtherNote = { author: string; where: string; text: string }

export type FollowUpContext = {
  title: string
  headSha: string
  baseSha: string
  lines: number
  reviewedSha: string | null
  verdict: string | null
  effort: string | null
  /** Headlines of commits after the reviewed SHA; null when it is not in the recent history. */
  commitsSince: string[] | null
  unresolved: PriorFinding[]
  others: OtherNote[]
}

const FINDING_RE = /^\*\*\[(blocking|high|medium|low)\]\*\* (.+)\n\n<sub>([a-z-]+)<\/sub>/u
const NOTE_CHARS = 360
/** Bots whose comments never carry review content. */
const NOISE_AUTHORS = new Set(['codecov', 'github-actions', 'dependabot', 'vercel', 'netlify'])
const NOISE_TEXT_RE = /usage limits|rate limit|review limit reached|review (?:summary|failed)[^.]*failed|review paused/iu

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

function priorFinding(thread: ReviewThread): PriorFinding | undefined {
  const match = FINDING_RE.exec(thread.comments.nodes[0]?.body ?? '')
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

function othersFrom(pull: PrConversation, finalIds: Set<string>): OtherNote[] {
  const threads = pull.reviewThreads.nodes.flatMap((thread) => {
    const first = thread.comments.nodes[0]
    if (thread.isResolved || first === undefined) return []
    if (finalIds.has(first.pullRequestReview?.id ?? '')) return []
    const where = `${thread.path}:${thread.line ?? 'file'}${thread.isOutdated ? ' (outdated)' : ''}`
    return [{ author: login(first.author), where, text: squash(first.body) }]
  })
  const reviews = pull.reviews.nodes.flatMap((review) => {
    if (finalIds.has(review.id) || review.body.trim().length === 0) return []
    const where = `review ${review.state.toLowerCase()} @${review.commit?.oid.slice(0, 7) ?? '?'}`
    return [{ author: login(review.author), where, text: squash(review.body) }]
  })
  const comments = pull.comments.nodes.flatMap((comment) =>
    comment.body.trim().length === 0
      ? []
      : [{ author: login(comment.author), where: 'comment', text: squash(comment.body) }],
  )
  return [...threads, ...reviews, ...comments]
    .filter((note) => !isNoise(note))
    .slice(-MAX_OTHER_NOTES)
}

/** Distills a pull request's review conversation into what a follow-up review needs. */
export function buildFollowUpContext(pull: PrConversation): FollowUpContext {
  const finalReviews = pull.reviews.nodes.filter(
    (review) => MARKER_RE.test(review.body) || PART_MARKER_RE.test(review.body),
  )
  const latest = pull.reviews.nodes
    .map((review) => MARKER_RE.exec(review.body))
    .filter((match) => match !== null)
    .at(-1)
  const reviewedSha = latest?.[1] ?? null
  const oids = pull.commits.nodes.map((node) => node.commit.oid)
  const index = reviewedSha === null ? -1 : oids.indexOf(reviewedSha)
  const finalIds = new Set(finalReviews.map((review) => review.id))
  const unresolved = pull.reviewThreads.nodes
    .filter(
      (thread) =>
        !thread.isResolved && finalIds.has(thread.comments.nodes[0]?.pullRequestReview?.id ?? ''),
    )
    .flatMap((thread) => priorFinding(thread) ?? [])
  return {
    title: pull.title,
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
    unresolved,
    others: othersFrom(pull, finalIds),
  }
}

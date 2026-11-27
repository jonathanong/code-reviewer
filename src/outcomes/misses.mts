import { parseBodyFindings } from '../review/body-findings.mts'
import { isNoise } from '../review/context/others.mts'
import { changed, type ClassifyContext } from './classify.mts'
import type { CommentData, MissRow, ReviewData } from './types.mts'

/** Lines either side of a finding of ours within which it covers another reviewer's range. */
export const COVERED_LINE_WINDOW = 10
/** Characters kept of the first line of the other reviewer's comment. */
export const SUMMARY_MAX = 120

type Spot = { path: string; start: number | null; end: number | null }

/** Whether `ours` is on the same file and, when both have lines, within the window of `theirs`. */
export function covers(ours: Spot, theirs: Spot): boolean {
  if (ours.path !== theirs.path) return false
  if (ours.start === null || ours.end === null || theirs.start === null || theirs.end === null) {
    return true
  }
  return (
    ours.start - COVERED_LINE_WINDOW <= theirs.end && ours.end + COVERED_LINE_WINDOW >= theirs.start
  )
}

const spot = (comment: CommentData): Spot | null =>
  comment.path === null
    ? null
    : { path: comment.path, start: comment.startLine, end: comment.endLine }

/** Every finding of ours on the pull request, at any head: our threads and our body findings. */
function ourSpots(ctx: ClassifyContext, ours: ReadonlySet<number>): Spot[] {
  const own = ctx.pull.threads
    .map((thread) => thread.comments[0])
    .filter((first) => first?.reviewId != null && ours.has(first.reviewId))
  const bodies = ctx.pull.reviews
    .filter((review) => ours.has(review.id))
    .flatMap((review) => parseBodyFindings(review.body))
    .map((found): Spot | null =>
      found.path === null ? null : { path: found.path, start: found.line, end: found.line },
    )
  return [...own.map((first) => spot(first as CommentData)), ...bodies].filter(
    (found): found is Spot => found !== null,
  )
}

function firstLine(body: string): string {
  const text = (body.split('\n').find((line) => line.trim() !== '') ?? '').trim()
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text
}

/**
 * Threads another reviewer opened that look real (a later commit changed the commented lines) and
 * that none of our findings covers. `mine` are this reviewer's reviews that the tracker lists.
 */
export async function findMisses(
  ctx: ClassifyContext,
  mine: readonly ReviewData[],
): Promise<MissRow[]> {
  const logins = new Set(mine.map((review) => review.author))
  const ours = new Set(ctx.pull.reviews.filter((r) => logins.has(r.author)).map((r) => r.id))
  const own = ourSpots(ctx, ours)
  const rows: MissRow[] = []
  for (const thread of ctx.pull.threads) {
    const first = thread.comments[0]
    if (first?.author == null || logins.has(first.author)) continue
    if (isNoise({ author: first.author, text: first.body })) continue
    const where = spot(first)
    if (where === null || own.some((found) => covers(found, where))) continue
    if (!(await changed(ctx, thread, first))) continue
    rows.push({
      repo: ctx.repo,
      pr: ctx.pr,
      key: `${ctx.repo}#${ctx.pr}/thread/${first.id}`,
      path: first.path,
      line: first.endLine,
      reviewer: first.author,
      url: first.url,
      summary: firstLine(first.body),
      checkedAt: ctx.now,
    })
  }
  return rows
}

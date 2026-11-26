import type { PageInfo, PrConversation, PrReview, ReviewThread } from './context-query.mts'
import { MARKER_RE } from './markers.mts'
import { isTrustedAuthor } from './trust.mts'

/**
 * Older pages of threads walked back for open ones (`reviewThreads` cannot filter on `isResolved`
 * server-side): with the newest page, at most 600 threads are looked at. Past it the conversation is
 * reported as cut short, because an open thread may lie beyond.
 */
export const MAX_OLDER_THREAD_PAGES = 5
/**
 * Older pages of reviews walked back, and only until this reviewer's last real review turns up:
 * the follow-up needs its SHA, verdict and questions. With the newest page, at most 360 reviews.
 */
export const MAX_OLDER_REVIEW_PAGES = 5

export type Page<T> = { nodes: T[]; pageInfo: PageInfo }
/** Reads the page of `connection` before the cursor. */
export type ReadOlder = <T>(
  connection: 'reviews' | 'reviewThreads',
  before: string,
) => Promise<Page<T>>

/** An open thread: unresolved, with a first comment that is not hidden. */
function isOpen(thread: ReviewThread): boolean {
  const first = thread.comments.nodes[0]
  return !thread.isResolved && first !== undefined && first.isMinimized !== true
}

/** Whether `review` is a real review (not a skip notice) of this reviewer's identity. */
function isOwnReview(review: PrReview, trusted: ReadonlySet<string>): boolean {
  const marker = MARKER_RE.exec(review.body)
  return (
    marker !== null && marker[2] !== 'Skipped' && isTrustedAuthor(review.author?.login, trusted)
  )
}

/**
 * Adds to `pull` what lies beyond its newest pages, each walk bounded.
 *
 * Threads: older pages up to `MAX_OLDER_THREAD_PAGES` are walked and only their open threads kept.
 * Reviews: with `trusted`, older pages are read until a real review of that identity is found, up to
 * `MAX_OLDER_REVIEW_PAGES`; without it only the newest page is read. A page needs the one before it
 * for its cursor, so the walks are sequential.
 */
export async function walkOlder(
  pull: PrConversation,
  older: ReadOlder,
  trusted: ReadonlySet<string> | undefined,
): Promise<void> {
  const { reviews, reviewThreads } = pull
  pull.olderSkipped =
    reviews.pageInfo?.hasPreviousPage === true || reviewThreads.pageInfo?.hasPreviousPage === true

  let threadsPage = reviewThreads.pageInfo
  let scanned = reviewThreads.nodes.length
  let kept: ReviewThread[] = []
  for (let pages = 0; pages < MAX_OLDER_THREAD_PAGES; pages += 1) {
    if (threadsPage?.hasPreviousPage !== true || !threadsPage.startCursor) break
    const page: Page<ReviewThread> = await older('reviewThreads', threadsPage.startCursor)
    kept = [...page.nodes.filter(isOpen), ...kept]
    scanned += page.nodes.length
    threadsPage = page.pageInfo
  }
  const threadsLeft = threadsPage?.hasPreviousPage === true
  reviewThreads.nodes = [...kept, ...reviewThreads.nodes]
  reviewThreads.pageInfo = { hasPreviousPage: threadsLeft }
  reviewThreads.unread = threadsLeft ? Math.max(1, (reviewThreads.totalCount ?? 0) - scanned) : 0

  if (trusted === undefined) return
  let reviewsPage = reviews.pageInfo
  let found = reviews.nodes.some((review) => isOwnReview(review, trusted))
  for (let pages = 0; pages < MAX_OLDER_REVIEW_PAGES && !found; pages += 1) {
    if (reviewsPage?.hasPreviousPage !== true || !reviewsPage.startCursor) break
    const page: Page<PrReview> = await older('reviews', reviewsPage.startCursor)
    reviews.nodes = [...page.nodes, ...reviews.nodes]
    found = page.nodes.some((review) => isOwnReview(review, trusted))
    reviewsPage = page.pageInfo
  }
  reviews.pageInfo = { hasPreviousPage: reviewsPage?.hasPreviousPage === true }
}

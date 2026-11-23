import type { ReviewIo } from './github.mts'
import { MARKER_RE } from './markers.mts'
import { isTrustedAuthor } from './trust.mts'

export type ReviewStatus = {
  headSha: string
  reviewedSha: string | null
  verdict: string | null
  effort: string | null
  current: boolean
  labeled: boolean
  /** True only when the newest review approved the current head and the label is on. */
  approved: boolean
  /** True when the newest review is a skip notice for the current head: nothing left to review. */
  skipped: boolean
}

/** Reports whether the latest review covers the current head, for merging agents. */
export async function reviewStatus(io: ReviewIo): Promise<ReviewStatus> {
  const [headSha, reviews, labeled, trusted] = await Promise.all([
    io.headSha(),
    io.listReviews(),
    io.hasApprovalLabel(),
    io.trustedAuthors(),
  ])
  const latest = reviews
    .filter((review) => isTrustedAuthor(review.author, trusted))
    .map((review) => MARKER_RE.exec(review.body))
    .filter((match): match is RegExpExecArray => match !== null)
    .at(-1)
  const reviewedSha = latest?.[1] ?? null
  const verdict = latest?.[2] ?? null
  const current = reviewedSha === headSha
  return {
    headSha,
    reviewedSha,
    verdict,
    effort: latest?.[3] ?? null,
    current,
    labeled,
    approved: current && labeled && verdict === 'Approve',
    skipped: current && verdict === 'Skipped',
  }
}

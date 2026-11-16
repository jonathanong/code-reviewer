import type { SanitizedReview } from '../review-payload/index.mts'
import { ReviewError } from './finding.mts'
import type { ReviewIo } from './github.mts'
import { skipReview, type LabelIo } from './labels.mts'
import { SHA_RE } from './post.mts'
import { reviewMarker } from './render.mts'
import type { LabelNames } from './settings.mts'

const REASON_CHARS = 300

/** One line of text that cannot open or close an HTML comment, so it cannot touch the marker. */
export function sanitizeReason(reason: string): string {
  const clean = reason
    .replaceAll('-->', '--&gt;')
    .replaceAll('<!--', '&lt;!--')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, REASON_CHARS)
    .trimEnd()
  return clean === '' ? 'no reason given' : clean
}

/** The notice `status` and `claim` read as "nothing to review at this head". */
export function skipNotice(headSha: string, reason: string): SanitizedReview {
  return {
    event: 'COMMENT',
    commit_id: headSha,
    body: `**Code review skipped:** ${sanitizeReason(reason)}\n\n${reviewMarker(headSha, 'Skipped', 'low')}`,
    comments: [],
  }
}

/**
 * Posts the skip notice, then swaps the labels, so a failed post leaves the labels as they were.
 * Refuses when the head cannot be read or is not `expectedHead`, the head the caller prepared.
 */
export async function skipPullRequest(
  io: ReviewIo,
  labelIo: LabelIo,
  names: LabelNames,
  reason: string,
  expectedHead?: string,
) {
  const headSha = await io.headSha()
  if (!SHA_RE.test(headSha)) throw new ReviewError('Cannot read the pull request head SHA.')
  if (expectedHead !== undefined && expectedHead !== headSha) {
    throw new ReviewError(
      `Pull request head is ${headSha}, not the prepared ${expectedHead}; re-review the new head.`,
    )
  }
  const url = await io.postReview(skipNotice(headSha, reason))
  const labels = await skipReview(labelIo, names)
  return { headSha, url, ...labels }
}

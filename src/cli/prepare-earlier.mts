import { resolve } from 'node:path'

import type { PullTarget } from '../review/index.mts'
import { unpostedReview } from '../review/earlier-lookup.mts'
import type { PrepareOptions } from '../review/prepare.mts'
import type { ReviewDeps } from './deps.mts'

/**
 * The lookup `prepare` runs once it finds the pull request has no posted review. The tracker is
 * only opened then, so a pull request with a posted review costs nothing.
 */
export function earlierFor(
  deps: ReviewDeps,
  target: () => PullTarget,
  out: string,
): NonNullable<PrepareOptions['earlier']> {
  return (headSha) => {
    const { repo, pr } = target()
    return unpostedReview(deps.tracker(), { repo, pr, headSha, out: resolve(out) })
  }
}

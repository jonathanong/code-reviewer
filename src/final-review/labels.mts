import type { RunTextCommand } from '../gh-cli/index.mts'
import { assertPullTarget, type PullTarget } from './github.mts'
import { FINAL_APPROVAL_LABEL } from './render.mts'

/** Added by a requester (human or agent) to ask the standing reviewer for a review. */
export const REQUESTED_LABEL = 'final-review:requested'
/** Set while a review runs, so a restart can find reviews it abandoned. */
export const IN_PROGRESS_LABEL = 'final-review:in-progress'
/** Set when the review is posted; the verdict lives in the review and `final approval`. */
export const COMPLETE_LABEL = 'final-review:complete'

/** Label reads and writes for one pull request, injectable for tests. */
export type LabelIo = {
  labels(): Promise<string[]>
  add(names: readonly string[]): Promise<void>
  remove(name: string): Promise<void>
}

export function createGhLabelIo(target: PullTarget, run: RunTextCommand): LabelIo {
  assertPullTarget(target)
  const issue = `repos/${target.repo}/issues/${target.pr}/labels`
  return {
    async labels() {
      const out = await run(['api', '--paginate', `${issue}?per_page=100`, '-q', '.[].name'])
      return out
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    },
    async add(names) {
      // The issues labels endpoint creates a missing label, so no setup step is needed.
      await run([
        'api',
        '--method',
        'POST',
        issue,
        ...names.flatMap((n) => ['-f', `labels[]=${n}`]),
      ])
    },
    async remove(name) {
      await run(['api', '--method', 'DELETE', `${issue}/${encodeURIComponent(name)}`, '--silent'])
    },
  }
}

/** Adds `add` first, then removes whichever of `remove` are present, so a PR is never unlabeled. */
async function swap(io: LabelIo, add: readonly string[], remove: readonly string[]) {
  const before = await io.labels()
  const missing = add.filter((name) => !before.includes(name))
  if (missing.length > 0) await io.add(missing)
  const removed = remove.filter((name) => before.includes(name))
  for (const name of removed) await io.remove(name)
  return { added: missing, removed }
}

export type ClaimOutcome =
  | { claimed: true; added: string[]; removed: string[] }
  | { claimed: false; reason: string; labels: string[] }

/**
 * Takes a requested review: marks it in progress and clears the request, a previous completion,
 * and a stale `final approval`. Without `force` it only claims a pull request that still carries
 * the request label, so a replayed or stale event is ignored.
 */
export async function claimReview(io: LabelIo, options: { force?: boolean } = {}) {
  const labels = await io.labels()
  if (options.force !== true && !labels.includes(REQUESTED_LABEL)) {
    const reason = labels.includes(IN_PROGRESS_LABEL)
      ? 'already in progress'
      : `no ${REQUESTED_LABEL} label`
    return { claimed: false, reason, labels } satisfies ClaimOutcome
  }
  const outcome = await swap(
    io,
    [IN_PROGRESS_LABEL],
    [REQUESTED_LABEL, COMPLETE_LABEL, FINAL_APPROVAL_LABEL],
  )
  return { claimed: true, ...outcome } satisfies ClaimOutcome
}

/** Marks the review posted. The approval label is handled by `postFinalReview`. */
export async function completeReview(io: LabelIo) {
  return swap(io, [COMPLETE_LABEL], [IN_PROGRESS_LABEL])
}

/**
 * Drops an in-progress review without posting. `requeue` asks again, for a failure worth retrying
 * once; never requeue automatically in a loop.
 */
export async function abortReview(io: LabelIo, options: { requeue?: boolean } = {}) {
  return swap(io, options.requeue === true ? [REQUESTED_LABEL] : [], [IN_PROGRESS_LABEL])
}

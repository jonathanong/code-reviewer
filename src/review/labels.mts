import type { RunTextCommand } from '../gh-cli/index.mts'
import { assertPullTarget, type PullTarget } from './target.mts'
import type { LabelNames } from './settings.mts'

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
 * the request label, so a replayed or stale event is ignored, and it declines a head the newest
 * review already covers (`headReviewed`) once posting finished: the marker rides on the first
 * review part, so only `complete` (set after every part and the approval label) proves that. A
 * requeued retry of a partial post is therefore claimed and finishes publication.
 */
export async function claimReview(
  io: LabelIo,
  names: LabelNames,
  options: { force?: boolean; headReviewed?: boolean } = {},
) {
  const labels = await io.labels()
  if (options.force !== true && options.headReviewed === true && labels.includes(names.completed)) {
    // The newest review covers this head: answer the request without touching the verdict.
    await swap(io, labels.includes(names.requested) ? [names.completed] : [], [names.requested])
    return { claimed: false, reason: 'head already reviewed', labels } satisfies ClaimOutcome
  }
  if (options.force !== true && !labels.includes(names.requested)) {
    const reason = labels.includes(names.processing)
      ? 'already in progress'
      : `no ${names.requested} label`
    return { claimed: false, reason, labels } satisfies ClaimOutcome
  }
  const outcome = await swap(
    io,
    [names.processing],
    [names.requested, names.completed, names.approval],
  )
  return { claimed: true, ...outcome } satisfies ClaimOutcome
}

/**
 * Marks the review posted. The approval label is handled by `postFinalReview`. The request is
 * cleared too: a held review puts it back, and `post` only runs for the current head, so a request
 * still present is the one this review answers.
 */
export async function completeReview(io: LabelIo, names: LabelNames) {
  return swap(io, [names.completed], [names.processing, names.requested])
}

/**
 * Drops an in-progress review without posting. `requeue` asks again, for a failure worth retrying
 * once; never requeue automatically in a loop.
 */
export async function abortReview(
  io: LabelIo,
  names: LabelNames,
  options: { requeue?: boolean } = {},
) {
  return swap(io, options.requeue === true ? [names.requested] : [], [names.processing])
}

/**
 * Closes out a pull request the plan decides not to review: the same label end state as a posted
 * review, but with no approval label added or removed, and nothing posted.
 */
export async function skipReview(io: LabelIo, names: LabelNames) {
  return swap(io, [names.completed], [names.processing, names.requested])
}

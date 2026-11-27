import type { RunTextCommand } from '../gh-cli/index.mts'
import { assertPullTarget, type PullTarget } from './target.mts'
import type { LabelNames } from './settings.mts'
import { heldFrom, holdStatus, parseTimelineRows, type Held } from './held-head.mts'
import { claimLost, holdReplaced, swap, undoClaim } from './label-claim-steps.mts'

/** Label reads and writes for one pull request, injectable for tests. */
export type LabelIo = {
  labels(): Promise<string[]>
  add(names: readonly string[]): Promise<void>
  remove(name: string): Promise<void>
  /** Where the timeline puts the current hold: its head (undefined when unknown) and how often it was placed. */
  heldHead(heldLabel: string): Promise<Held>
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
    async heldHead(heldLabel) {
      const out = await run([
        'api',
        '--paginate',
        `repos/${target.repo}/issues/${target.pr}/timeline?per_page=100`,
        '-q',
        '.[] | select(.event == "committed" or .event == "head_ref_force_pushed" or .event == "labeled" or .event == "unlabeled") | [.event, (if .event == "labeled" or .event == "unlabeled" then (.label.name // "") else (.sha // .commit_id // "") end)] | @tsv',
      ])
      return heldFrom(parseTimelineRows(out), heldLabel)
    },
  }
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
 * requeued retry of a partial post is therefore claimed and finishes publication. A pull request
 * carrying the held label is declined while the hold is on the current head (`headSha`): a person
 * has to post, skip or abort it (or `force`). A hold on an older head is stale, so the new head is
 * claimed and the swap clears the stale hold.
 */
export async function claimReview(
  io: LabelIo,
  names: LabelNames,
  options: {
    force?: boolean
    headReviewed?: boolean
    /** The pull request's current head, to tell a stale hold from a current one. */
    headSha?: string | undefined
    /** The pull request's head as read now; a claim for another head declines, the head moved. */
    liveHeadSha?: string | undefined
    /** True when a review of this head was posted since the claim began; only asked of a first claim. */
    reviewedSince?: () => Promise<boolean>
  } = {},
) {
  const labels = await io.labels()
  if (
    options.headSha !== undefined &&
    options.liveHeadSha !== undefined &&
    options.headSha.toLowerCase() !== options.liveHeadSha.toLowerCase()
  ) {
    // The head moved since the caller pinned it, so a hold may belong to the newer head; the
    // caller reviews the new head instead.
    return { claimed: false, reason: 'head moved', labels } satisfies ClaimOutcome
  }
  if (options.force !== true && options.headReviewed === true && labels.includes(names.completed)) {
    // The newest review covers this head: answer the request without touching the verdict.
    await swap(io, labels.includes(names.requested) ? [names.completed] : [], [names.requested])
    return { claimed: false, reason: 'head already reviewed', labels } satisfies ClaimOutcome
  }
  let staleHold: Held | undefined
  if (options.force !== true && labels.includes(names.held)) {
    // A person re-requesting does not undo a hold on this head; only `force`, `post`, `skip` or
    // `abort` does. A hold on an older head is stale and gives way to the new head.
    const hold = await holdStatus(io, names, options.headSha)
    if (!hold.stale) return { claimed: false, reason: hold.reason, labels } satisfies ClaimOutcome
    staleHold = hold.held
  }
  if (options.force !== true && !labels.includes(names.requested)) {
    const reason = labels.includes(names.processing)
      ? 'already in progress'
      : `no ${names.requested} label`
    return { claimed: false, reason, labels } satisfies ClaimOutcome
  }
  // A forced claim or a stale hold is cleared. Otherwise the hold stays, so the re-read below still
  // sees a hold another machine set after our first read.
  const outcome = await swap(
    io,
    [names.processing],
    [
      names.requested,
      names.completed,
      names.approval,
      ...(options.force === true || staleHold !== undefined ? [names.held] : []),
    ],
  )
  if (options.force === true) return { claimed: true, ...outcome } satisfies ClaimOutcome
  let lost: boolean
  try {
    lost =
      (staleHold !== undefined && (await holdReplaced(io, names, staleHold))) ||
      (await claimLost(io, names, options))
  } catch (error) {
    // Best effort, like `abort --requeue`: drop the in-progress label this claim added and ask
    // again, so the pull request is not stuck. The original failure is the one to report.
    await undoClaim(io, names, outcome).catch(() => undefined)
    throw error
  }
  if (lost) {
    // Leave the labels as the other claimant left them; removing its in-progress would unclaim it.
    return {
      claimed: false,
      reason: 'claim lost',
      labels: await io.labels(),
    } satisfies ClaimOutcome
  }
  return { claimed: true, ...outcome } satisfies ClaimOutcome
}

/**
 * Marks the review posted. The approval label is handled by `postFinalReview`. The request is
 * cleared too: a held review puts it back, and `post` only runs for the current head, so a request
 * still present is the one this review answers.
 */
export async function completeReview(io: LabelIo, names: LabelNames) {
  return swap(io, [names.completed], [names.processing, names.requested, names.held])
}

/**
 * Drops an in-progress review without posting. `requeue` asks again, for a failure worth retrying
 * once; never requeue automatically in a loop. `hold` is for a finished review that waits for a
 * person: it sets the held label, which no machine claims, instead of the request label, which any
 * machine would. Without either it clears a standing hold too.
 */
export async function abortReview(
  io: LabelIo,
  names: LabelNames,
  options: { requeue?: boolean; hold?: boolean } = {},
) {
  if (options.hold === true) return swap(io, [names.held], [names.processing])
  return swap(io, options.requeue === true ? [names.requested] : [], [names.processing, names.held])
}

/**
 * Closes out a pull request the plan decides not to review: the same label end state as a posted
 * review, but with no approval label added or removed, and nothing posted.
 */
export async function skipReview(io: LabelIo, names: LabelNames) {
  return swap(io, [names.completed], [names.processing, names.requested, names.held])
}

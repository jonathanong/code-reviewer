import type { ClaimOutcome, LabelIo } from './labels.mts'
import type { LabelNames } from './settings.mts'
import type { Held } from './held-head.mts'

/** Adds `add` first, then removes whichever of `remove` are present, so a PR is never unlabeled. */
export async function swap(io: LabelIo, add: readonly string[], remove: readonly string[]) {
  const before = await io.labels()
  const missing = add.filter((name) => !before.includes(name))
  if (missing.length > 0) await io.add(missing)
  const removed = remove.filter((name) => before.includes(name))
  for (const name of removed) await io.remove(name)
  return { added: missing, removed }
}

/**
 * After a stale hold was removed: whether the timeline shows the hold placed again since the
 * lookup that judged it stale. If so, the swap deleted a current hold, so put it back and drop our
 * in-progress label. Labels have no compare-and-set, so this narrows the window without closing it.
 */
export async function holdReplaced(io: LabelIo, names: LabelNames, seen: Held): Promise<boolean> {
  const now = await io.heldHead(names.held).catch(() => undefined)
  if (now === undefined || now.placements <= seen.placements) return false
  await swap(io, [names.held], [names.processing])
  return true
}

export async function undoClaim(io: LabelIo, names: LabelNames, outcome: { added: string[] }) {
  // An unforced claim only gets here with the request label present, and the swap removed it.
  await io.add([names.requested])
  if (outcome.added.includes(names.processing)) await io.remove(names.processing)
}

/**
 * Re-reads after the swap. Reading and claiming are separate calls and labels have no
 * compare-and-set, so two machines can both pass the first read. This catches the ones that left a
 * trace by now: a request, hold or completion that appeared after our swap, our own in-progress
 * label gone, or (`reviewedSince`) a review of this head posted since the claim began. It narrows
 * the window; two claims whose writes interleave without either seeing the other's still both win.
 */
export async function claimLost(
  io: LabelIo,
  names: LabelNames,
  options: { reviewedSince?: (() => Promise<boolean>) | undefined },
): Promise<boolean> {
  const after = await io.labels()
  if (
    !after.includes(names.processing) ||
    [names.requested, names.held, names.completed].some((name) => after.includes(name))
  ) {
    return true
  }
  return (await options.reviewedSince?.()) === true
}

/**
 * Takes a reviewed pull request for a reply-only re-assessment: in-progress goes on and the
 * completion goes off, so `claimLost` sees any request, hold or completion that appears after, and
 * `reviewedSince` a review that landed. A pull request already requested, in progress or held is
 * declined. Like any claim it narrows the window; labels have no compare-and-set.
 */
export async function claimReplies(
  io: LabelIo,
  names: LabelNames,
  options: { reviewedSince?: (() => Promise<boolean>) | undefined },
): Promise<ClaimOutcome> {
  const labels = await io.labels()
  const busy = [names.requested, names.processing, names.held].filter((name) =>
    labels.includes(name),
  )
  if (busy.length > 0) {
    return { claimed: false, reason: `the pull request carries ${busy.join(', ')}`, labels }
  }
  const outcome = await swap(io, [names.processing], [names.completed])
  let lost: boolean
  try {
    lost = await claimLost(io, names, options)
  } catch (error) {
    await releaseReplies(io, names).catch(() => undefined)
    throw error
  }
  if (lost) return { claimed: false, reason: 'claim lost', labels: await io.labels() }
  return { claimed: true, ...outcome }
}

/**
 * Gives a re-assessment's claim back: the in-progress label goes off and the completion goes back
 * on. A request or hold placed meanwhile stays, and then the completion is left off so the next
 * review claims it.
 */
export async function releaseReplies(io: LabelIo, names: LabelNames) {
  const labels = await io.labels()
  const waiting = labels.includes(names.requested) || labels.includes(names.held)
  return swap(io, waiting ? [] : [names.completed], [names.processing])
}

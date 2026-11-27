import type { LabelIo } from './labels.mts'
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

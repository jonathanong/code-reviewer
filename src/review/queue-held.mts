import type { TrackerIo } from '../tracker/types.mts'
import { heldReview } from './earlier-lookup.mts'
import type { QueueEntry } from './queue.mts'

/**
 * Marks a requested entry `held` when this machine has an unposted review of exactly its head, so a
 * loop can tell it from a fresh request. An in-progress entry is left as it is.
 */
export function markHeld(entries: readonly QueueEntry[], io: TrackerIo): QueueEntry[] {
  return entries.map((entry) => {
    if (entry.state !== 'requested') return entry
    const runDir = heldReview(io, {
      repo: entry.repo,
      pr: entry.pr,
      headSha: entry.headSha,
    })
    return runDir === undefined ? entry : { ...entry, state: 'held', runDir }
  })
}

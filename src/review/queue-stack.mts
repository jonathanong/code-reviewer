import type { RunTextCommand } from '../gh-cli/index.mts'
import type { QueueEntry } from './queue.mts'
import { fetchOpenPulls } from './stack-gh.mts'
import { walkStack } from './stack.mts'

type Annotated = QueueEntry & { stack: NonNullable<QueueEntry['stack']> }

const repoKey = (repo: string) => repo.toLowerCase()

/** The stack position of one entry among its repository's open pull requests, if it has one. */
async function annotate(
  run: RunTextCommand,
  repo: string,
  entries: readonly QueueEntry[],
): Promise<QueueEntry[]> {
  let pulls
  try {
    pulls = await fetchOpenPulls(run, repo)
  } catch {
    // The queue still lists the pull requests, just unordered; prepare reports the problem.
    return [...entries]
  }
  return entries.map((entry) => {
    const walk = walkStack(entry.pr, pulls)
    if (walk === undefined || walk.members.length === 1) return entry
    const root = (walk.members[0] as { number: number }).number
    return { ...entry, stack: { root, position: walk.index + 1, size: walk.members.length } }
  })
}

/**
 * Marks queued pull requests that belong to a stack and groups each stack's queued members next to
 * each other, bottom-up, at the place its first member was listed. Other rows keep their order.
 * One open-pull-request read per repository.
 */
export async function groupStacks(
  run: RunTextCommand,
  entries: readonly QueueEntry[],
): Promise<QueueEntry[]> {
  const byRepo = new Map<string, QueueEntry[]>()
  for (const entry of entries) {
    byRepo.set(repoKey(entry.repo), [...(byRepo.get(repoKey(entry.repo)) ?? []), entry])
  }
  const annotated = (
    await Promise.all(
      [...byRepo.values()].map((group) => annotate(run, (group[0] as QueueEntry).repo, group)),
    )
  ).flat()
  const byEntry = new Map(annotated.map((entry) => [`${repoKey(entry.repo)}#${entry.pr}`, entry]))
  const stackKey = (entry: Annotated) => `${repoKey(entry.repo)}#${entry.stack.root}`
  const placed = new Set<string>()
  return entries.flatMap((original) => {
    const entry = byEntry.get(`${repoKey(original.repo)}#${original.pr}`) as QueueEntry
    if (entry.stack === undefined) return [entry]
    const key = stackKey(entry as Annotated)
    if (placed.has(key)) return []
    placed.add(key)
    return annotated
      .filter((other): other is Annotated => other.stack !== undefined)
      .filter((other) => stackKey(other) === key)
      .sort((left, right) => left.stack.position - right.stack.position)
  })
}

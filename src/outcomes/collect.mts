import { foldRows, readRows } from '../tracker/store.mts'
import type { TrackerIo, TrackerRow } from '../tracker/types.mts'
import { classifyReview } from './classify.mts'
import { fetchPull } from './fetch.mts'
import type { OutcomeRow, OutcomesIo } from './types.mts'

export const DEFAULT_SINCE_DAYS = 30
/** Pull requests checked per run; the rest are reported as not checked. */
export const MAX_PULLS = 50
const DAY_MS = 86_400_000

export type CollectOptions = {
  repos: readonly string[]
  owner: string | undefined
  pr: number | undefined
  sinceDays: number
}

export type Collected = {
  rows: OutcomeRow[]
  pulls: number
  notChecked: number
  problems: string[]
}

const postedAt = (row: TrackerRow) => row.postedAt ?? row.finishedAt ?? row.startedAt ?? ''

function wanted(row: TrackerRow, options: CollectOptions, cutoff: number): boolean {
  const repo = row.repo.toLowerCase()
  return (
    row.state === 'posted' &&
    row.reviewId !== null &&
    Date.parse(postedAt(row)) >= cutoff &&
    (options.repos.length === 0 || options.repos.some((name) => name.toLowerCase() === repo)) &&
    (options.owner === undefined || repo.startsWith(`${options.owner.toLowerCase()}/`)) &&
    (options.pr === undefined || row.pr === options.pr)
  )
}

/** Posted reviews of the window, grouped by pull request, newest activity first. */
function groupByPull(rows: readonly TrackerRow[]): TrackerRow[][] {
  const groups = new Map<string, TrackerRow[]>()
  for (const row of rows) {
    const key = `${row.repo.toLowerCase()}#${row.pr}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const newest = (group: TrackerRow[]) => group.map(postedAt).sort().at(-1) as string
  return [...groups.values()].sort((a, b) => newest(b).localeCompare(newest(a)))
}

/** Reads GitHub for every posted review in the tracker that matches, and classifies its findings. */
export async function collectOutcomes(
  options: CollectOptions,
  tracker: TrackerIo,
  io: OutcomesIo,
): Promise<Collected> {
  const now = tracker.now()
  const cutoff = now.getTime() - options.sinceDays * DAY_MS
  const { rows: tracked, problems } = readRows(tracker)
  const groups = groupByPull(foldRows(tracked).filter((row) => wanted(row, options, cutoff)))
  const rows: OutcomeRow[] = []
  for (const group of groups.slice(0, MAX_PULLS)) {
    const { repo, pr } = group[0] as TrackerRow
    try {
      const [owner = '', name = ''] = repo.split('/')
      const pull = await fetchPull(io.run(owner, name), repo, pr)
      if (pull.truncated) problems.push(`${repo}#${pr} has more reviews or threads than were read.`)
      const ctx = { repo, pr, pull, io, now: now.toISOString(), problems }
      for (const entry of group) {
        const review = pull.reviews.find((candidate) => candidate.id === entry.reviewId)
        if (review === undefined) {
          problems.push(`${repo}#${pr}: review ${entry.reviewId} is no longer on the pull request.`)
          continue
        }
        const found = await classifyReview(ctx, review)
        rows.push(...found.map((found) => ({ ...found, head: entry.head })))
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      problems.push(`${repo}#${pr} was not checked: ${reason}`)
    }
  }
  return {
    rows,
    pulls: Math.min(groups.length, MAX_PULLS),
    notChecked: Math.max(groups.length - MAX_PULLS, 0),
    problems,
  }
}

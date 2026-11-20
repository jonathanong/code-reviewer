export const TRACKER_STATES = ['reviewed', 'posted', 'skipped', 'failed'] as const
export type TrackerState = (typeof TRACKER_STATES)[number]

export type TrackerMode = 'full' | 'light' | 'follow-up' | 'skip'

export type Counts = { blocking: number; high: number; medium: number; low: number }

/**
 * One line of `reviews.jsonl`. A value the writer did not know is null, so every line has the
 * same shape; `repo`, `pr` and `head` identify the review run a later line updates.
 */
export type TrackerRow = {
  repo: string
  pr: number
  /** The reviewed head SHA; empty when a failed run never learned it. */
  head: string
  state: TrackerState
  title: string | null
  author: string | null
  mode: TrackerMode | null
  verdict: string | null
  counts: Counts | null
  questions: number | null
  costUsd: number | null
  startedAt: string | null
  finishedAt: string | null
  /** Why a run was skipped or failed. */
  reason: string | null
  reviewUrl: string | null
  /** The GitHub review event of the posted review. */
  event: string | null
  /** Why the verdict went out as a COMMENT: self-review, identity-unknown, or rejected. */
  downgraded: string | null
  postedAt: string | null
  runDir: string | null
}

/** What the tracker needs from outside: a state directory, files, and a clock. */
export type TrackerIo = {
  dir: string
  /** The file's text, or undefined when it does not exist. */
  read(path: string): string | undefined
  /** Appends `text` in one write, creating the directory first. */
  append(path: string, text: string): void
  now(): Date
}

import { RUN_EXIT, type RunExit } from '../run/output.mts'

/** What `replies` prints, as one JSON line. */
export type RepliesLine = {
  outcome: 'applied' | 'held' | 'noop' | 'error'
  exitCode: RunExit
  repo: string | null
  pr: number | null
  headSha: string | null
  reason: string | null
  verdictBefore: string | null
  verdictAfter: string | null
  judged: Array<{ thread: string; outcome: string; severity: string; why: string }>
  /** Threads with new replies that were not judged, each with why. */
  unjudged: Array<{ thread: string; why: string }>
  reviewUrl: string | null
  event: string | null
  replied: string[]
  resolved: string[]
  /** What a writer would do next: held, or the problems a write ran into. */
  attention: string[]
  costUsd: number | null
  /** The command a person runs to apply a held result. */
  applyCommand: string | null
}

const BLANK: RepliesLine = {
  outcome: 'noop',
  exitCode: RUN_EXIT.noop,
  repo: null,
  pr: null,
  headSha: null,
  reason: null,
  verdictBefore: null,
  verdictAfter: null,
  judged: [],
  unjudged: [],
  reviewUrl: null,
  event: null,
  replied: [],
  resolved: [],
  attention: [],
  costUsd: null,
  applyCommand: null,
}

export function line(patch: Partial<RepliesLine>): RepliesLine {
  return { ...BLANK, ...patch }
}

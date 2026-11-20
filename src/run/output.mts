/**
 * The exit codes of `code-reviewer run`, defined once. They avoid 1 (`status`, `review`, `plugins`)
 * and 2 (any other command's usage or runtime error).
 */
export const RUN_EXIT = {
  posted: 0,
  held: 10,
  noop: 11,
  precondition: 12,
  failed: 13,
} as const

export type RunExit = (typeof RUN_EXIT)[keyof typeof RUN_EXIT]

export type Counts = { blocking: number; high: number; medium: number; low: number }

/** The single line `run` prints on stdout. */
export type RunLine = {
  repo: string | null
  pr: number | null
  headSha: string | null
  outcome: 'posted' | 'held' | 'noop' | 'error'
  exitCode: RunExit
  verdict: string | null
  /** The review event that was posted. */
  event: string | null
  /** The hold rules that matched. */
  held: string[]
  findings: Counts | null
  questions: number | null
  reviewUrl: string | null
  /** The ids of the reviews `post` read back from the pull request, one per part. */
  reviewIds: number[]
  /** The second check on an approval, when the review ran one. */
  approvalCheck: 'upheld' | 'changed' | 'failed' | null
  costUsd: number | null
  tokens: { input: number; output: number } | null
  mode: string | null
  /** How the head was checked out: a worktree of a local clone, or a fresh blobless clone. */
  tree: 'worktree' | 'clone' | null
  runDir: string | null
  /** The Markdown explainer of the review, for posted and held alike. */
  explainPath: string | null
  /** The command a human runs to post a held review. */
  postCommand: string | null
  /** Why a human should look: the held rules and the problems; empty for a clean posted review. */
  attention: string[]
  problems: string[]
  reason: string | null
}

const BLANK: Omit<RunLine, 'outcome' | 'exitCode'> = {
  repo: null,
  pr: null,
  headSha: null,
  verdict: null,
  event: null,
  held: [],
  findings: null,
  questions: null,
  reviewUrl: null,
  reviewIds: [],
  approvalCheck: null,
  costUsd: null,
  tokens: null,
  mode: null,
  tree: null,
  runDir: null,
  explainPath: null,
  postCommand: null,
  attention: [],
  problems: [],
  reason: null,
}

/** A line with every field present, so a caller reads the same shape for every outcome. */
export function runLine(
  outcome: RunLine['outcome'],
  exitCode: RunExit,
  fields: Partial<RunLine>,
): RunLine {
  return { ...BLANK, ...fields, outcome, exitCode }
}

export function writeLine(line: RunLine): RunExit {
  process.stdout.write(`${JSON.stringify(line)}\n`)
  return line.exitCode
}

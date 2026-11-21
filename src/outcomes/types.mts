import type { RunTextCommand } from '../gh-cli/index.mts'

export const OUTCOMES = [
  'fixed',
  'disputed',
  'dismissed',
  'open',
  'ignored',
  'resolved',
  'rejected',
] as const
export type Outcome = (typeof OUTCOMES)[number]

/** Thumbs-up and thumbs-down counts, and every other reaction kept raw by GitHub's name. */
export type Reactions = { up: number; down: number; other: Record<string, number> }

/** One line of `outcomes.jsonl`: what became of one posted finding. */
export type OutcomeRow = {
  repo: string
  pr: number
  reviewId: number
  head: string
  /** Stable across runs: the review and the comment (or, for a body finding, its title). */
  key: string
  pillar: string | null
  severity: string | null
  /** The rule skill (`plugin:skill`) the finding names in backticks, if any. */
  rule: string | null
  title: string
  path: string | null
  url: string | null
  outcome: Outcome
  /** `finding` is the inline comment (zero for a body finding), `review` the review body. */
  reactions: { finding: Reactions; review: Reactions }
  checkedAt: string
}

export type CommentData = {
  id: number
  author: string | null
  body: string
  url: string | null
  path: string | null
  /** The commented range at the commit the comment was made on. */
  startLine: number | null
  endLine: number | null
  oid: string | null
  reviewId: number | null
  reactions: Reactions
}

export type ThreadData = { resolved: boolean; outdated: boolean; comments: CommentData[] }

export type ReviewData = {
  id: number
  state: string
  body: string
  url: string | null
  author: string | null
  reactions: Reactions
}

export type PullData = {
  state: string
  head: string
  reviews: ReviewData[]
  threads: ThreadData[]
  /** A connection had more pages than the bound allows. */
  truncated: boolean
}

/** What `outcomes` needs from outside. */
export type OutcomesIo = {
  /** A read-only `gh` runner for the repository. */
  run(owner: string, repo: string): RunTextCommand
  git: RunTextCommand
  findClone(repo: string): Promise<string | undefined>
}

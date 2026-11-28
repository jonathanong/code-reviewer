import type { ReviewDeps } from '../cli/deps.mts'
import type { RepliesLine } from '../cli/command-replies-line.mts'
import type { PullTarget } from '../review/index.mts'
import { isTrustedAuthor, type TrustedAuthors } from '../review/trust.mts'
import { preflight } from '../run/preflight.mts'
import type { HarnessEvent } from './harness.mts'

/** The GitHub reads and the reply run `wait` needs beyond `ReviewDeps`, injected for tests. */
export type WaitIo = {
  isOpen(pull: PullTarget): Promise<boolean>
  /** The login of the author of a review comment; undefined when it is gone. */
  commentAuthor(repo: string, commentId: number): Promise<string | undefined>
  /** The same run as `code-reviewer replies --post auto`. */
  replies(pull: PullTarget): Promise<RepliesLine>
}

export type WaitRequest = { repo: string; pr: number; headSha: string | null }

/** A reply run that needs a person or failed. */
export type WaitAttention = PullTarget &
  Pick<RepliesLine, 'outcome' | 'exitCode' | 'reason' | 'attention' | 'reviewUrl' | 'applyCommand'>

export type Batch = {
  requests: WaitRequest[]
  attention: WaitAttention[]
  handled: { applied: number; noop: number }
  /** Events dropped, by why. */
  dropped: Record<string, number>
  /** Reads that failed; a request whose check failed is still returned, as `run` re-checks it. */
  problems: string[]
}

/** Comment events for one pull request that wait for its in-progress label to clear. */
export type PendingReplies = {
  pull: PullTarget
  roots: Set<number>
  events: number
  /** Polls it has waited so far. */
  tries: number
}

export type HandleContext = {
  deps: ReviewDeps
  io: WaitIo
  /** The request labels the wait was started on, lower-cased. */
  labels: ReadonlySet<string>
  /** This reviewer's own logins. */
  own: TrustedAuthors
  /** Senders to drop on top of this reviewer. */
  ignoreSenders: readonly string[]
  /** Replies on a pull request whose replies run was busy, tried again on the next poll. */
  pending: Map<string, PendingReplies>
}

export const emptyBatch = (): Batch => ({
  requests: [],
  attention: [],
  handled: { applied: 0, noop: 0 },
  dropped: {},
  problems: [],
})

export const key = (pull: PullTarget) => `${pull.repo.toLowerCase()}#${pull.pr}`

export const pullsOf = (event: HarnessEvent): PullTarget[] =>
  event.repo == null ? [] : (event.prs ?? []).map((pr) => ({ repo: event.repo as string, pr }))

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function drop(batch: Batch, why: string, count = 1): void {
  batch.dropped[why] = (batch.dropped[why] ?? 0) + count
}

export const isRequestEvent = (event: HarnessEvent, labels: ReadonlySet<string>): boolean =>
  event.label != null && labels.has(event.label.toLowerCase())

/**
 * One entry per pull request at its newest head, for the request label events that survive: not
 * this reviewer's own, not an issue, the pull request open, the request label still on it (the
 * label is the truth, events replay), and the head not already reviewed, held or in progress
 * (`preflight`, the check `run` makes first).
 */
export async function handleRequests(
  events: readonly HarnessEvent[],
  ctx: HandleContext,
  batch: Batch,
): Promise<void> {
  const newest = new Map<string, { pull: PullTarget; headSha: string | null }>()
  for (const event of events) {
    if (event.issue !== undefined && event.issue !== null) drop(batch, 'issue')
    else if (isTrustedAuthor(event.sender?.login, ctx.own)) drop(batch, 'own label change')
    else {
      for (const pull of pullsOf(event)) {
        newest.delete(key(pull))
        newest.set(key(pull), { pull, headSha: event.headSha ?? null })
      }
    }
  }
  for (const { pull, headSha } of newest.values()) {
    try {
      if (!(await ctx.io.isOpen(pull))) {
        drop(batch, 'closed')
        continue
      }
      const found = await preflight(ctx.deps, pull, false)
      if (found.noop !== undefined) drop(batch, 'head already handled')
      else if (!found.labels.some((name) => ctx.labels.has(name.toLowerCase()))) {
        drop(batch, 'no request label')
      } else batch.requests.push({ ...pull, headSha: found.headSha })
    } catch (error) {
      batch.problems.push(`${pull.repo}#${pull.pr}: could not check the request: ${message(error)}`)
      batch.requests.push({ ...pull, headSha })
    }
  }
}

export function attentionOf(
  pull: PullTarget,
  line: Omit<WaitAttention, 'repo' | 'pr'>,
): WaitAttention {
  return {
    ...pull,
    outcome: line.outcome,
    exitCode: line.exitCode,
    reason: line.reason,
    attention: line.attention,
    reviewUrl: line.reviewUrl,
    applyCommand: line.applyCommand,
  }
}

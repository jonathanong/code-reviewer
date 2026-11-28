import type { ReviewDeps } from '../cli/deps.mts'
import { labelsFor } from '../cli/review-settings.mts'
import type { RepliesLine } from '../cli/command-replies-line.mts'
import { reviewStatus, type PullTarget } from '../review/index.mts'
import { isTrustedAuthor, type TrustedAuthors } from '../review/trust.mts'
import { RUN_EXIT } from '../run/output.mts'
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

export type HandleContext = {
  deps: ReviewDeps
  io: WaitIo
  /** The request labels the wait was started on, lower-cased. */
  labels: ReadonlySet<string>
  /** This reviewer's own logins. */
  own: TrustedAuthors
  /** Senders to drop on top of this reviewer. */
  ignoreSenders: readonly string[]
}

export const emptyBatch = (): Batch => ({
  requests: [],
  attention: [],
  handled: { applied: 0, noop: 0 },
  dropped: {},
  problems: [],
})

const key = (pull: PullTarget) => `${pull.repo.toLowerCase()}#${pull.pr}`

const pullsOf = (event: HarnessEvent): PullTarget[] =>
  event.repo === undefined
    ? []
    : (event.prs ?? []).map((pr) => ({ repo: event.repo as string, pr }))

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function drop(batch: Batch, why: string, count = 1): void {
  batch.dropped[why] = (batch.dropped[why] ?? 0) + count
}

export const isRequestEvent = (event: HarnessEvent, labels: ReadonlySet<string>): boolean =>
  event.label !== undefined && labels.has(event.label.toLowerCase())

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
      else if (!found.labels.includes(found.names.requested)) drop(batch, 'no request label')
      else batch.requests.push({ ...pull, headSha: found.headSha })
    } catch (error) {
      batch.problems.push(`${pull.repo}#${pull.pr}: could not check the request: ${message(error)}`)
      batch.requests.push({ ...pull, headSha })
    }
  }
}

function attentionOf(pull: PullTarget, line: Omit<WaitAttention, 'repo' | 'pr'>): WaitAttention {
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

/**
 * Runs `replies` for the pull requests whose new review comment is a reply in a thread this
 * reviewer started. The cheap checks go first: the root comment's author (one call per thread),
 * then an open pull request, a review by this reviewer, and no request, in-progress or held label.
 * Only a held or failed result is kept, as attention; an applied or no-op one is counted.
 */
export async function handleComments(
  events: readonly HarnessEvent[],
  ctx: HandleContext,
  batch: Batch,
): Promise<void> {
  const ignored = new Set([...ctx.own, ...ctx.ignoreSenders])
  const groups = new Map<string, { pull: PullTarget; roots: Set<number>; events: number }>()
  for (const event of events) {
    const comment = event.payload?.comment
    if (isTrustedAuthor(event.sender?.login, ignored)) drop(batch, 'ignored sender')
    else if (comment === undefined) {
      batch.problems.push('a review comment event came without its payload')
      drop(batch, 'no payload')
    } else if (comment.in_reply_to_id === undefined || comment.in_reply_to_id === null) {
      drop(batch, 'not a reply')
    } else {
      const pulls = pullsOf(event)
      if (pulls.length === 0) drop(batch, 'no pull request')
      for (const pull of pulls) {
        const group = groups.get(key(pull)) ?? { pull, roots: new Set<number>(), events: 0 }
        group.roots.add(comment.in_reply_to_id)
        group.events += 1
        groups.set(key(pull), group)
      }
    }
  }
  for (const { pull, roots, events: count } of groups.values()) {
    try {
      const why = await skipReason(pull, roots, ctx)
      if (why !== undefined) {
        drop(batch, why, count)
        continue
      }
      const line = await ctx.io.replies(pull)
      if (line.exitCode === RUN_EXIT.posted) batch.handled.applied += 1
      else if (line.exitCode === RUN_EXIT.noop) batch.handled.noop += 1
      else batch.attention.push(attentionOf(pull, line))
    } catch (error) {
      batch.attention.push(
        attentionOf(pull, {
          outcome: 'error',
          exitCode: RUN_EXIT.failed,
          reason: message(error),
          attention: [],
          reviewUrl: null,
          applyCommand: null,
        }),
      )
    }
  }
}

/** Why the replies run is not worth making for this pull request; undefined when it is. */
async function skipReason(
  pull: PullTarget,
  roots: ReadonlySet<number>,
  ctx: HandleContext,
): Promise<string | undefined> {
  let mine = false
  for (const root of roots) {
    mine = isTrustedAuthor(await ctx.io.commentAuthor(pull.repo, root), ctx.own)
    if (mine) break
  }
  if (!mine) return 'not a thread this reviewer started'
  if (!(await ctx.io.isOpen(pull))) return 'closed'
  if ((await reviewStatus(ctx.deps.createIo(pull))).reviewedSha === null) {
    return 'no review by this reviewer'
  }
  const names = await labelsFor(ctx.deps, pull.repo)
  const labels = await ctx.deps.createLabelIo(pull).labels()
  const busy = [names.requested, names.processing, names.held].some((name) => labels.includes(name))
  return busy ? 'request, in-progress or held label' : undefined
}

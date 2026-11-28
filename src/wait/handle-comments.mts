import { labelsFor } from '../cli/review-settings.mts'
import { reviewStatus, type PullTarget } from '../review/index.mts'
import { isTrustedAuthor } from '../review/trust.mts'
import { RUN_EXIT } from '../run/output.mts'
import type { HarnessEvent } from './harness.mts'
import {
  attentionOf,
  drop,
  key,
  message,
  pullsOf,
  type Batch,
  type HandleContext,
  type PendingReplies,
} from './handle.mts'

/** `skipReason` for a pull request that is being worked on: its replies wait, not drop. */
const IN_PROGRESS = 'in progress'

/**
 * Polls a reply may wait for a pull request's in-progress label to clear, about five minutes at
 * hook-harness's default poll interval. Bounded so a stuck claim cannot hold replies forever; past
 * it the reply is dropped and counted.
 */
export const MAX_BUSY_POLLS = 60

/**
 * Runs `replies` for the pull requests whose new review comment is a reply in a thread this
 * reviewer started. The cheap checks go first: the root comment's author (one call per thread),
 * then an open pull request, a review by this reviewer, and no request, in-progress or held label.
 * A held or failed result, or any result that carries attention lines, is kept as attention; the
 * other applied or no-op results are counted. A reply on a pull request whose in-progress label is
 * set waits in `ctx.pending` and is tried again on each poll, up to `MAX_BUSY_POLLS`.
 */
export async function handleComments(
  events: readonly HarnessEvent[],
  ctx: HandleContext,
  batch: Batch,
): Promise<void> {
  const ignored = new Set([...ctx.own, ...ctx.ignoreSenders])
  const groups = new Map<string, PendingReplies>()
  for (const [id, waiting] of ctx.pending)
    groups.set(id, { ...waiting, roots: new Set(waiting.roots) })
  ctx.pending.clear()
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
        const group = groups.get(key(pull)) ?? {
          pull,
          roots: new Set<number>(),
          events: 0,
          tries: 0,
        }
        group.roots.add(comment.in_reply_to_id)
        group.events += 1
        groups.set(key(pull), group)
      }
    }
  }
  for (const [id, group] of groups) {
    const { pull, events: count } = group
    try {
      const why = await skipReason(pull, group.roots, ctx)
      if (why === IN_PROGRESS) {
        if (group.tries + 1 >= MAX_BUSY_POLLS) drop(batch, 'in progress too long', count)
        else ctx.pending.set(id, { ...group, tries: group.tries + 1 })
        continue
      }
      if (why !== undefined) {
        drop(batch, why, count)
        continue
      }
      const line = await ctx.io.replies(pull)
      if (line.exitCode !== RUN_EXIT.posted && line.exitCode !== RUN_EXIT.noop) {
        batch.attention.push(attentionOf(pull, line))
      } else if (line.attention.length > 0) batch.attention.push(attentionOf(pull, line))
      else if (line.exitCode === RUN_EXIT.posted) batch.handled.applied += 1
      else batch.handled.noop += 1
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
  if (labels.includes(names.requested) || labels.includes(names.held)) {
    return 'request or held label'
  }
  return labels.includes(names.processing) ? IN_PROGRESS : undefined
}

import { join } from 'node:path'

import type { ReviewDeps } from '../cli/deps.mts'
import { RUN_EXIT, type RunExit } from '../run/output.mts'
import { Precondition } from '../run/preflight.mts'
import type { TrustedAuthors } from '../review/trust.mts'
import {
  emptyBatch,
  handleComments,
  handleRequests,
  isRequestEvent,
  type Batch,
  type WaitIo,
} from './handle.mts'
import { CursorRejected, type Harness } from './harness.mts'

export type WaitOptions = {
  owners: string[]
  /** The request labels to wake on. */
  labels: string[]
  ignoreSenders: string[]
  timeoutSeconds: number
  cursorName: string
  own: TrustedAuthors
}

/** What `wait` injects beyond `ReviewDeps`: the hook-harness poll and the GitHub reads. */
export type WaitRun = WaitIo & {
  harness: Harness
}

/** What `wait` prints, as one JSON line. */
export type WaitLine = Omit<Batch, 'problems'> & {
  outcome: 'work' | 'timeout' | 'gap' | 'error'
  exitCode: RunExit
  gap: boolean
  timedOut: boolean
  cursor: string | null
  error: string | null
  problems: string[]
}

/**
 * Transient errors in a row, from one owner, after which `wait` returns the outage. hook-harness
 * retries each with a backoff of 10s, 20s, 40s, 80s, so five in a row is about 2.5 minutes down:
 * long enough to ride out a rate limit or a relay restart, short enough that the loop hears of a
 * real outage in minutes. Counted per owner, so a healthy owner cannot hide a dead one.
 */
export const MAX_TRANSIENT_ERRORS = 5

const cursorPath = (deps: ReviewDeps, name: string) =>
  join(deps.tracker().dir, `wait-${name}.cursor`)

export const waitFailure = (error: unknown): { error: string; exitCode: RunExit } => ({
  error: error instanceof Error ? error.message : String(error),
  exitCode: error instanceof Precondition ? RUN_EXIT.precondition : RUN_EXIT.failed,
})

function line(batch: Batch, patch: Partial<WaitLine>): WaitLine {
  return {
    outcome: 'timeout',
    exitCode: RUN_EXIT.noop,
    gap: false,
    timedOut: false,
    cursor: null,
    error: null,
    ...batch,
    ...patch,
  }
}

/**
 * Polls hook-harness until something needs the session: a request label to review, a held or
 * failed `replies` run, a gap in the event history, a hook-harness outage, or the timeout. Events
 * that need nothing are dropped and the wait goes on. The cursor is kept in the state directory and
 * moves only after a batch is handled, so a crash replays it.
 */
export async function wait(
  options: WaitOptions,
  deps: ReviewDeps,
  run: WaitRun,
): Promise<WaitLine> {
  const batch = emptyBatch()
  const store = deps.tracker()
  const path = cursorPath(deps, options.cursorName)
  const labels = new Set(options.labels.map((label) => label.toLowerCase()))
  const context = { deps, io: run, labels, own: options.own, ignoreSenders: options.ignoreSenders }
  const signal = AbortSignal.timeout(options.timeoutSeconds * 1000)
  let cursor = store.read(path)?.trim() || undefined
  const errors = new Map<string, number>()
  try {
    for await (const polled of run.harness({
      owners: options.owners,
      labels: options.labels,
      ignoreSenders: options.ignoreSenders,
      signal,
      after: cursor,
    })) {
      if ('error' in polled) {
        const count = (errors.get(polled.owner) ?? 0) + 1
        errors.set(polled.owner, count)
        if (count >= MAX_TRANSIENT_ERRORS) {
          return line(batch, {
            outcome: 'error',
            exitCode: RUN_EXIT.failed,
            cursor: cursor ?? null,
            error: `hook-harness failed ${count} polls in a row for ${polled.owner}: ${polled.error.message}`,
          })
        }
        continue
      }
      errors.delete(polled.owner)
      if (polled.gap) {
        store.write(path, `${polled.cursor}\n`)
        return line(batch, {
          outcome: 'gap',
          exitCode: RUN_EXIT.posted,
          gap: true,
          cursor: polled.cursor,
        })
      }
      await handleRequests(
        polled.events.filter((event) => isRequestEvent(event, labels)),
        context,
        batch,
      )
      await handleComments(
        polled.events.filter(
          (event) =>
            !isRequestEvent(event, labels) &&
            event.event === 'pull_request_review_comment' &&
            event.action === 'created',
        ),
        context,
        batch,
      )
      cursor = polled.cursor
      store.write(path, `${cursor}\n`)
      if (batch.requests.length > 0 || batch.attention.length > 0) {
        return line(batch, { outcome: 'work', exitCode: RUN_EXIT.posted, cursor })
      }
    }
  } catch (error) {
    if (error instanceof CursorRejected) {
      throw new Precondition(
        `the cursor in ${path} is not one hook-harness accepts (${error.message}); delete the file to start from now.`,
        { cause: error },
      )
    }
    throw error
  }
  return line(batch, { cursor: cursor ?? null, timedOut: true })
}

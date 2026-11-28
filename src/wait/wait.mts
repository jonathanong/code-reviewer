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
import type { Harness } from './harness.mts'

export type WaitOptions = {
  owners: string[]
  /** The request labels to wake on. */
  labels: string[]
  ignoreSenders: string[]
  timeoutSeconds: number
  cursorName: string
  own: TrustedAuthors
}

/** What `wait` injects beyond `ReviewDeps`: the hook-harness call, the clock and the GitHub reads. */
export type WaitRun = WaitIo & {
  harness: Harness
  now(): number
  sleep(ms: number): Promise<void>
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

/** Tries of a hook-harness wait that failed on a rate limit, the first included. */
const HARNESS_TRIES = 3
const RATE_LIMIT = /rate.?limit|\b429\b|too many requests/iu
/** hook-harness exits 1 on a 401 or 403: the login or the token's scope, a configuration problem. */
const AUTH_FAILURE = /\b40[13]\b|hook-harness login|unauthori[sz]ed/iu

const cursorPath = (deps: ReviewDeps, name: string) =>
  join(deps.tracker().dir, `wait-${name}.cursor`)

export const waitFailure = (error: unknown): { error: string; exitCode: RunExit } => {
  const text = error instanceof Error ? error.message : String(error)
  return {
    error: text,
    exitCode:
      error instanceof Precondition || AUTH_FAILURE.test(text)
        ? RUN_EXIT.precondition
        : RUN_EXIT.failed,
  }
}

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
 * Waits on hook-harness until something needs the session: a request label to review, a held or
 * failed `replies` run, a gap in the event history, a hook-harness failure, or the timeout. Events
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
  const deadline = run.now() + options.timeoutSeconds * 1000
  let cursor = store.read(path)?.trim() || undefined
  let failures = 0
  for (;;) {
    const remaining = Math.ceil((deadline - run.now()) / 1000)
    if (remaining <= 0) return line(batch, { cursor: cursor ?? null, timedOut: true })
    let result
    try {
      result = await run.harness({
        owners: options.owners,
        labels: options.labels,
        ignoreSenders: options.ignoreSenders,
        timeoutSeconds: remaining,
        after: cursor,
      })
    } catch (error) {
      const failure = waitFailure(error)
      failures += 1
      if (RATE_LIMIT.test(failure.error) && failures < HARNESS_TRIES) {
        await run.sleep(failures * 5000)
        continue
      }
      return line(batch, { outcome: 'error', cursor: cursor ?? null, ...failure })
    }
    failures = 0
    if (result.gap) {
      store.write(path, `${result.cursor}\n`)
      return line(batch, {
        outcome: 'gap',
        exitCode: RUN_EXIT.posted,
        gap: true,
        cursor: result.cursor,
      })
    }
    await handleRequests(
      result.events.filter((event) => isRequestEvent(event, labels)),
      context,
      batch,
    )
    await handleComments(
      result.events.filter(
        (event) =>
          !isRequestEvent(event, labels) &&
          event.event === 'pull_request_review_comment' &&
          event.action === 'created',
      ),
      context,
      batch,
    )
    cursor = result.cursor
    store.write(path, `${cursor}\n`)
    if (batch.requests.length > 0 || batch.attention.length > 0) {
      return line(batch, { outcome: 'work', exitCode: RUN_EXIT.posted, cursor })
    }
    if (result.timedOut === true) return line(batch, { cursor, timedOut: true })
  }
}

import {
  AuthError,
  BadRequestError,
  NotLoggedInError,
  pollEvents,
  resolveClient,
  type Envelope,
} from '../../vendor/hook-harness-client.mjs'

import { Precondition } from '../run/preflight.mts'

/** One event, reduced to the fields `wait` reads. */
export type HarnessEvent = {
  repo?: string | null
  prs?: number[]
  event?: string
  action?: string | null
  /** Set for an issue (not a pull request). */
  issue?: unknown
  sender?: { login?: string } | null
  /** The label a label event added. */
  label?: string | null
  headSha?: string | null
  payload?: {
    comment?: {
      id?: number
      in_reply_to_id?: number | null
      user?: { login?: string }
    }
  }
}

/** One poll of one owner: its new events and the cursor that resumes every owner, or a transient error. */
export type HarnessBatch =
  | { owner: string; events: HarnessEvent[]; cursor: string; gap: boolean }
  | { owner: string; error: Error }

/** What one hook-harness poll is asked for. */
export type HarnessCall = {
  owners: string[]
  /** The request labels to wake on. */
  labels: string[]
  /** Senders whose review-comment events hook-harness drops itself. */
  ignoreSenders: string[]
  /** Ends the poll when it aborts. */
  signal: AbortSignal
  after: string | undefined
}

/** Polls until `call.signal` aborts. Throws `Precondition` for a configuration problem. */
export type Harness = (call: HarnessCall) => AsyncIterable<HarnessBatch>

/** Raised when hook-harness rejects the saved cursor; `wait` names the file. */
export class CursorRejected extends Precondition {}

const LOGIN_HINT = 'run `hook-harness login`, or set HOOK_HARNESS_URL and HOOK_HARNESS_TOKEN'

/**
 * A failure that retrying cannot fix, as a `Precondition`: no login, a refused token, a request the
 * relay calls bad, or a relay URL that would send the token in cleartext. Anything else is returned
 * unchanged.
 */
export function configurationFailure(error: unknown): unknown {
  if (error instanceof NotLoggedInError) {
    return new Precondition(`hook-harness is not logged in: ${LOGIN_HINT}.`, { cause: error })
  }
  if (error instanceof AuthError) {
    return new Precondition(`hook-harness's token was refused (${error.message}): ${LOGIN_HINT}.`, {
      cause: error,
    })
  }
  if (error instanceof BadRequestError) {
    return new Precondition(`the hook-harness relay rejected the request: ${error.message}`, {
      cause: error,
    })
  }
  if (error instanceof TypeError) {
    return new Precondition(
      `hook-harness cannot be used with this relay URL or preset: ${error.message}. The URL must be https, or http on localhost (${LOGIN_HINT}).`,
      { cause: error },
    )
  }
  if (error instanceof Error && error.message.startsWith('invalid cursor')) {
    return new CursorRejected(error.message, { cause: error })
  }
  return error
}

/** The envelope's fields `wait` reads; the comment is picked out of the payload, which is untyped. */
export function toEvent(envelope: Envelope): HarnessEvent {
  const comment = envelope.payload?.['comment']
  const found =
    typeof comment === 'object' && comment !== null
      ? (comment as { id?: unknown; in_reply_to_id?: unknown; user?: { login?: unknown } | null })
      : undefined
  const login = found?.user?.login
  return {
    repo: envelope.repo,
    prs: envelope.prs,
    event: envelope.event,
    action: envelope.action,
    issue: envelope.issue,
    sender: envelope.sender,
    label: envelope.label ?? null,
    headSha: envelope.headSha,
    ...(found === undefined
      ? {}
      : {
          payload: {
            comment: {
              ...(typeof found.id === 'number' ? { id: found.id } : {}),
              in_reply_to_id:
                typeof found.in_reply_to_id === 'number' ? found.in_reply_to_id : null,
              ...(typeof login === 'string' ? { user: { login } } : {}),
            },
          },
        }),
  }
}

export type HarnessOptions = {
  /** Where the saved login and the `HOOK_HARNESS_*` overrides are read from. */
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
  /** Time between polls once caught up, and the backoff base. */
  intervalMs?: number
}

/**
 * The default harness: hook-harness's in-process client. One `pollEvents` covers every owner and
 * the request-label presets, plus review-comment `created` events minus the ignored senders. The
 * payload stays on because a reply is told apart by `payload.comment.in_reply_to_id`.
 */
export function createHarness(options: HarnessOptions = {}): Harness {
  return async function* (call) {
    try {
      const client = await resolveClient(options.env ?? process.env)
      for await (const batch of pollEvents({
        ...client,
        owner: call.owners,
        on: call.labels.map((label) => `label:${label}`),
        filters: [
          {
            event: 'pull_request_review_comment',
            action: 'created',
            ignoreSenders: call.ignoreSenders,
          },
        ],
        signal: call.signal,
        ...(call.after === undefined ? {} : { after: call.after }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
      })) {
        yield 'error' in batch
          ? batch
          : { ...batch, events: batch.events.map((envelope) => toEvent(envelope)) }
      }
    } catch (error) {
      throw configurationFailure(error)
    }
  }
}

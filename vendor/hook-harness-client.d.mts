// Types for the parts of vendor/hook-harness-client.mjs that the reviewer uses; hand-written, not generated.

/** The relay's event, reduced to the fields the reviewer reads. */
export interface Envelope {
  id: string
  receivedAt: string
  event: string
  action: string | null
  owner: string
  repo: string | null
  prs: number[]
  issue: number | null
  headSha: string | null
  sender: { login: string; type: string } | null
  label?: string | null
  /** The webhook body; absent when it was not requested or was too large. */
  payload?: Record<string, unknown>
}

export interface EventFilter {
  event?: string | string[]
  action?: string | string[]
  /** Logins whose events never match. */
  ignoreSenders?: string[]
}

export interface ClientConfig {
  url: string
  token: string
}

export interface PollEventsOptions {
  url: string
  token: string
  /** One owner, or several polled side by side under one cursor. */
  owner: string | string[]
  /** An event matches when it matches any filter or `on` preset. */
  filters?: EventFilter[]
  /** Preset names, as `hook-harness wait --on` takes them, such as `label:<name>`. */
  on?: string[]
  /** Include the webhook payload (default true). */
  payload?: boolean
  /** A `cursor` from an earlier batch, or one `hook-harness wait` saved. */
  after?: string
  since?: Date
  signal?: AbortSignal
  intervalMs?: number
  fetch?: typeof fetch
}

export type EventsBatch = { owner: string } & (
  | { events: Envelope[]; cursor: string; gap: boolean }
  | { error: Error }
)

/** Polls until `signal` aborts; yields a batch per poll, and a transient error instead of throwing it. */
export function pollEvents(options: PollEventsOptions): AsyncGenerator<EventsBatch>

/** The saved `hook-harness login`, with `HOOK_HARNESS_URL` and `HOOK_HARNESS_TOKEN` overriding it. */
export function resolveClient(env?: NodeJS.ProcessEnv): Promise<ClientConfig>

/** The relay refused the token. */
export class AuthError extends Error {}
/** HTTP 401. */
export class UnauthorizedError extends AuthError {}
/** HTTP 403: a valid token with no scope under the owner. */
export class OutOfScopeError extends AuthError {
  constructor(message: string, owner: string, scopes: string[] | undefined)
}
/** Any other non-2xx response; the poller retries it. */
export class RelayError extends Error {
  readonly status: number
  constructor(status: number, message?: string)
}
/** HTTP 400: a bad `after` or `filters`; the poller throws it. */
export class BadRequestError extends RelayError {}
/** `pollEvents` threw it: the `after` cursor is not one the relay accepts. */
export class InvalidCursorError extends Error {}
/** No relay URL and token in the environment or the saved login. */
export class NotLoggedInError extends Error {}

/** Why a GitHub call failed, as far as a retry decision needs to know. */
export type Failure =
  | { kind: 'transient'; reason: string; retryAfterMs?: number }
  | { kind: 'permanent'; reason: string }

/** The longest `retry-after` a call waits out; a longer one fails the call instead. */
export const RETRY_AFTER_CAP_MS = 60_000

const GATEWAY_STATUSES = new Set([502, 503, 504])

const NETWORK_PATTERNS = [
  /\bECONNRESET\b/iu,
  /\bETIMEDOUT\b/iu,
  /\bEAI_AGAIN\b/iu,
  /connection reset by peer/iu,
  /\bi\/o timeout\b/iu,
  /TLS handshake timeout/iu,
  /context deadline exceeded/iu,
  /Client\.Timeout/iu,
  /socket hang up/iu,
  /unexpected EOF/iu,
]

/** The text a failed `gh` run left behind: the thrown message plus the child's stderr. */
export function failureText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const { stderr } = error as { stderr?: unknown }
  return typeof stderr === 'string' ? `${error.message}\n${stderr}` : error.message
}

/** `gh` does not print response headers, so a wait shows only when GitHub put it in the message. */
function retryAfterMs(text: string): number | undefined {
  const found = /retry[- ]after[:=\s]+(\d+)/iu.exec(text)
  return found?.[1] === undefined ? undefined : Number(found[1]) * 1000
}

function rateLimited(text: string, status: number | undefined): boolean {
  return status === 429 || (status === 403 && /secondary rate limit|abuse detection/iu.test(text))
}

/**
 * Sorts a failed GitHub call. Transient: a 502, 503 or 504, a dropped or timed-out connection, and
 * a secondary rate limit or 429 whose wait (when GitHub names one) fits `RETRY_AFTER_CAP_MS`.
 * Everything else is permanent, so a bad token, a missing resource, a validation error, or a
 * problem this module cannot name fails at once instead of being repeated.
 */
export function classifyFailure(error: unknown): Failure {
  const text = failureText(error)
  const status = /\bHTTP (\d{3})\b/u.exec(text)?.[1]
  const code = status === undefined ? undefined : Number(status)
  const wait = retryAfterMs(text)
  if (rateLimited(text, code)) {
    if (wait !== undefined && wait > RETRY_AFTER_CAP_MS) {
      return { kind: 'permanent', reason: `rate limited for ${wait / 1000}s, over the wait cap` }
    }
    const reason = `rate limited (HTTP ${code})`
    return { kind: 'transient', reason, ...(wait === undefined ? {} : { retryAfterMs: wait }) }
  }
  if (code !== undefined) {
    return GATEWAY_STATUSES.has(code)
      ? { kind: 'transient', reason: `HTTP ${code}` }
      : { kind: 'permanent', reason: `HTTP ${code}` }
  }
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(text))) {
    return { kind: 'transient', reason: 'network failure' }
  }
  return { kind: 'permanent', reason: 'not a transient failure' }
}

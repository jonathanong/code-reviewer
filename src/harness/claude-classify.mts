import { ExecError } from '../review/benchmark/exec.mts'
import { resultEvent } from './claude-usage.mts'
import type { FailureClass } from './types.mts'

const OTHER: FailureClass = { kind: 'other' }
const API_ERROR = /^API Error:? (\d{3})\b/u

/** The HTTP status of an API error result: its `api_error_status`, else the `API Error: <status>` text. */
function statusOf(event: Record<string, unknown>): number | undefined {
  if (typeof event.api_error_status === 'number') return event.api_error_status
  const match = typeof event.result === 'string' ? API_ERROR.exec(event.result) : null
  return match === null ? undefined : Number(match[1])
}

/**
 * Reads the failed run's final `result` event. Only a result flagged `is_error` that names an API
 * status is classified: 429 is a rate limit, 529 is overload, 401 is auth. Everything else, and a
 * failure that printed no result event, is `other`.
 */
export function classifyFailure(error: unknown): FailureClass {
  if (!(error instanceof ExecError)) return OTHER
  const event = resultEvent(error.stdout)
  if (event === undefined || event.is_error !== true) return OTHER
  const status = statusOf(event)
  if (status === 429) return { kind: 'rate_limited' }
  if (status === 529) return { kind: 'overloaded' }
  if (status === 401) return { kind: 'auth' }
  return OTHER
}

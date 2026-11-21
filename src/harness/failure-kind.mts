import { ExecError } from '../review/benchmark/exec.mts'
import { resultEvent } from './claude-usage.mts'
import { HarnessRefusal } from './refusal.mts'
import type { FailureClass } from './types.mts'

/**
 * Why a step failed when the cause is the harness and not the review: the call timed out, a rate
 * limit or overload outlived the retry budget, the CLI rejected a flag, it exited without a
 * result, or it printed no JSON. Failures that carry an answer from the model (a turn limit, a
 * refusal of capabilities) and credential problems have none.
 */
export const HARNESS_FAILURE_KINDS = [
  'timeout',
  'rate_limited',
  'overloaded',
  'unsupported_flag',
  'crash',
  'unparseable',
] as const
export type HarnessFailureKind = (typeof HARNESS_FAILURE_KINDS)[number]

const UNSUPPORTED_FLAG =
  /\b(unknown|unrecognized|unexpected|invalid) (option|argument|flag|command)\b|\bno such option\b/iu

/**
 * The harness failure kind of `error`, which `failure` already classified for waiting and
 * fallback; undefined when the failure is not the harness's.
 */
export function harnessFailureKind(
  error: unknown,
  failure: FailureClass,
): HarnessFailureKind | undefined {
  if (failure.kind === 'rate_limited' || failure.kind === 'overloaded') return failure.kind
  if (failure.kind === 'auth' || error instanceof HarnessRefusal) return undefined
  if (!(error instanceof ExecError)) return 'unparseable'
  if ((error.cause as { killed?: unknown } | undefined)?.killed === true) return 'timeout'
  if (UNSUPPORTED_FLAG.test(error.message)) return 'unsupported_flag'
  return resultEvent(error.stdout) === undefined ? 'crash' : undefined
}

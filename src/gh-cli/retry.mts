import { classifyFailure, failureText, RETRY_AFTER_CAP_MS, type Failure } from './failure.mts'
import { callKind, settledByEarlierTry } from './retry-safety.mts'

/** The one retry policy for GitHub calls. */
export const RETRY_POLICY = {
  /** Tries per call, the first included: two retries. */
  maxAttempts: 3,
  /** The wait before the first retry; each later one doubles it. */
  baseDelayMs: 1000,
  /** No computed backoff goes above this; `retry-after` has its own cap. */
  maxDelayMs: 8000,
  retryAfterCapMs: RETRY_AFTER_CAP_MS,
  /**
   * GitHub's review list can lag behind a just-created review: a read that misses it is repeated
   * this many more times, this long apart, before the review is called absent.
   */
  readBackExtraReads: 2,
  readBackDelayMs: 1000,
} as const

/** What retrying needs from outside the policy: a clock to wait on and a jitter source. */
export type Retrier = {
  sleep(ms: number): Promise<void>
  /** A number in [0, 1). */
  random(): number
  /** How many retries happened; the command reports it once as a warning. */
  stats: { retries: number }
}

export function createRetrier(overrides: Partial<Retrier> = {}): Retrier {
  return {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    stats: { retries: 0 },
    ...overrides,
  }
}

/** Shared by every runner this process builds, so one command reports one count. */
export const processRetrier = createRetrier()

/** Returns the retry count since the last call and resets it. */
export function takeRetryCount(retrier: Retrier = processRetrier): number {
  const { retries } = retrier.stats
  retrier.stats.retries = 0
  return retries
}

/**
 * The wait before retry number `retry` (1 for the first). A named `retry-after` is honoured as
 * given (the classifier already refused one over the cap); otherwise exponential backoff with
 * jitter, which lands between half and all of the step so callers do not retry in lockstep.
 */
export function retryDelay(retrier: Retrier, failure: Failure, retry: number): number {
  if (failure.kind === 'transient' && failure.retryAfterMs !== undefined) {
    return Math.min(failure.retryAfterMs, RETRY_POLICY.retryAfterCapMs)
  }
  const step = Math.min(RETRY_POLICY.baseDelayMs * 2 ** (retry - 1), RETRY_POLICY.maxDelayMs)
  return Math.round(step / 2 + (retrier.random() * step) / 2)
}

/** Waits out the delay for `retry` and counts it. */
export async function pauseForRetry(
  retrier: Retrier,
  failure: Failure,
  retry: number,
): Promise<void> {
  retrier.stats.retries += 1
  await retrier.sleep(retryDelay(retrier, failure, retry))
}

type Run = (args: string[]) => Promise<string>

/**
 * Wraps a runner so a read, or a write that is safe to repeat, survives a transient failure (see
 * `classifyFailure`). Any other write fails on its first error: the caller owns the decision,
 * because only it can check whether the write landed. A permanent failure is never retried.
 */
export function withRetry(run: Run, retrier: Retrier = processRetrier): Run {
  return async (args) => {
    const kind = callKind(args)
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run(args)
      } catch (error) {
        const failure = classifyFailure(error)
        if (attempt > 1 && settledByEarlierTry(args, failure.reason, failureText(error))) return ''
        const spent = attempt >= RETRY_POLICY.maxAttempts
        if (failure.kind === 'permanent' || kind === 'write' || spent) throw error
        await pauseForRetry(retrier, failure, attempt)
      }
    }
  }
}

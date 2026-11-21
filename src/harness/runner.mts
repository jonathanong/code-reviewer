import type { Exec } from '../review/benchmark/exec.mts'
import type { Usage } from '../review/benchmark/usage.mts'
import { harness as claude } from './claude.mts'
import { harnessNamed } from './registry.mts'
import type { Candidate, Harness, HarnessResult, HarnessRun } from './types.mts'

/** Which harness and model ran a step, and how long it waited out rate limits first. */
export type StepRan = { harness: string; model: string; waitedMs: number }

/** What a step does around its model calls; tests inject `sleep` and `now`. */
export type StepRuntime = {
  /** Total time one call may spend waiting on rate limits and overload, across its candidates. */
  maxWaitSeconds: number
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export const DEFAULT_MAX_WAIT_SECONDS = 600
const BACKOFF_BASE_MS = 5_000
const BACKOFF_CAP_MS = 60_000

export const realRuntime = (maxWaitSeconds = DEFAULT_MAX_WAIT_SECONDS): StepRuntime => ({
  maxWaitSeconds,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
})

/** A failed step: the last candidate's failure, described, with what ran and how long it waited. */
export class StepFailure extends Error {
  readonly ran: StepRan
  readonly usage: Usage | null

  constructor(message: string, usage: Usage | null, ran: StepRan, cause: unknown) {
    super(message, { cause })
    this.usage = usage
    this.ran = ran
  }
}

/** The message and usage to record for a failed step, whichever harness ran it. */
export function describeStepFailure(error: unknown): {
  message: string
  usage: Usage | null
  ran?: StepRan
} {
  if (error instanceof StepFailure) {
    return { message: error.message, usage: error.usage, ran: error.ran }
  }
  return claude.describeFailure(error)
}

export type StepRequest = Omit<HarnessRun, 'model'>

/**
 * Runs a step on its first candidate. A rate limit or overload waits (the named retry-after, else
 * an exponential backoff with a cap) and retries the same candidate until the wait budget is
 * spent, then moves to the next candidate. An auth failure moves on at once. Any other failure is
 * the step's failure, as it always was. When the candidates run out the last failure is thrown as
 * a `StepFailure`.
 */
export async function runStep(
  request: StepRequest,
  candidates: readonly Candidate[],
  exec: Exec,
  runtime: StepRuntime = realRuntime(),
): Promise<HarnessResult & { ran: StepRan }> {
  let waitedMs = 0
  const budgetMs = runtime.maxWaitSeconds * 1000
  for (const [position, candidate] of candidates.entries()) {
    const adapter = harnessNamed(candidate.harness) as Harness
    const last = position === candidates.length - 1
    for (let attempt = 0; ; attempt += 1) {
      const ran = { harness: candidate.harness, model: candidate.model, waitedMs }
      try {
        const result = await adapter.run({ ...request, model: candidate.model }, exec)
        return { ...result, ran }
      } catch (error) {
        const failure = adapter.classifyFailure(error)
        const wait =
          failure.kind === 'rate_limited' && failure.retryAfterSeconds !== undefined
            ? failure.retryAfterSeconds * 1000
            : Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt)
        const waits = failure.kind === 'rate_limited' || failure.kind === 'overloaded'
        if (waits && waitedMs + wait <= budgetMs) {
          const started = runtime.now()
          await runtime.sleep(wait)
          waitedMs += runtime.now() - started
          continue
        }
        const moveOn = waits || failure.kind === 'auth'
        if (!moveOn || last) {
          const { message, usage } = adapter.describeFailure(error)
          throw new StepFailure(message, usage, ran, error)
        }
        break
      }
    }
  }
  throw new Error('A step needs at least one model candidate.')
}

/** A benchmark call: the request's own model on Claude, with the default wait budget, so scores stay comparable. */
export function runFixedModel(request: HarnessRun, exec: Exec): Promise<HarnessResult> {
  const { model, ...rest } = request
  return runStep(rest, [{ harness: claude.name, model }], exec)
}

import type { Exec } from '../review/benchmark/exec.mts'
import { addUsage, type Usage } from '../review/benchmark/usage.mts'
import { harness as claude } from './claude.mts'
import { harnessFailureKind, type HarnessFailureKind } from './failure-kind.mts'
import { HarnessRefusal } from './refusal.mts'
import { harnessNamed } from './registry.mts'
import type { Candidate, Harness, HarnessResult, HarnessRun } from './types.mts'

/** Which harness and model ran a step, and how long it waited out rate limits first. */
export type StepRan = {
  harness: string
  model: string
  waitedMs: number
  /** Set only on a failed step whose failure is the harness's. */
  failure?: HarnessFailureKind
}

/** What a step does around its model calls; tests inject `sleep` and `now`. */
export type StepRuntime = {
  /** Total time one call may spend waiting on rate limits and overload, across its candidates. */
  maxWaitSeconds: number
  sleep: (ms: number) => Promise<void>
  now: () => number
  /** Told before each wait on a rate limit or overload: how long, on which candidate, and why. */
  onWait?: (ms: number, on: StepRan, why: string) => void
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

/** Optional shell commands and the prompt section that explains them; a harness that refuses the shell grant gets neither. */
export type StepAnalysis = { commands: readonly string[]; section: string }

export type StepRequest = Omit<HarnessRun, 'model'> & { analysis?: StepAnalysis | undefined }

/**
 * What `adapter` runs for `request`. The analysis grant and section go in unless the adapter's own
 * `assertCan` refuses the request with them, so one check decides what a harness can confine.
 */
function forAdapter(request: StepRequest, adapter: Harness, candidate: Candidate): HarnessRun {
  const { model, readsOutsideCheckout: reads } = candidate
  const { analysis, ...rest } = request
  const plain: HarnessRun = {
    ...rest,
    model,
    ...(reads === true ? { readsOutsideCheckout: true } : {}),
  }
  if (analysis === undefined) return plain
  const granted: HarnessRun = {
    ...plain,
    prompt: `${rest.prompt}\n\n${analysis.section}`,
    can: { ...rest.can, shell: [...rest.can.shell, ...analysis.commands] },
  }
  try {
    adapter.assertCan?.(granted)
  } catch {
    // `assertCan` throws nothing but a refusal.
    return plain
  }
  return granted
}

/** A step's result: `usage` counts every attempt, `failedUsage` only the ones that failed. */
export type StepRun = HarnessResult & { ran: StepRan; failedUsage: Usage | null }

/**
 * Runs a step on its first candidate. A rate limit or overload waits (the named retry-after, else
 * an exponential backoff with a cap) and retries the same candidate until the wait budget is
 * spent, then moves to the next candidate. An auth failure, an adapter refusing the step's
 * capabilities, or a failure of the harness itself (`harnessFailureKind`: timeout, crash, rejected
 * flag, unparseable output) moves on at once. A failure that carries a model answer is the step's
 * failure. When the candidates run out the last failure is thrown as
 * a `StepFailure`. The usage every failed attempt reported adds to the result's `usage` (and to
 * the `StepFailure`'s); `failedUsage` is that part alone, `reportedUsage` the last attempt's own.
 */
export async function runStep(
  request: StepRequest,
  candidates: readonly Candidate[],
  exec: Exec,
  runtime: StepRuntime = realRuntime(),
): Promise<StepRun> {
  let waitedMs = 0
  // What attempts that were retried or fell back to another candidate reported; it still cost.
  let failedUsage: Usage | null = null
  const budgetMs = runtime.maxWaitSeconds * 1000
  for (const [position, candidate] of candidates.entries()) {
    const adapter = harnessNamed(candidate.harness) as Harness
    const last = position === candidates.length - 1
    for (let attempt = 0; ; attempt += 1) {
      const ran = { harness: candidate.harness, model: candidate.model, waitedMs }
      try {
        const result = await adapter.run(forAdapter(request, adapter, candidate), exec)
        return { ...result, usage: addUsage(failedUsage, result.usage) as Usage, ran, failedUsage }
      } catch (error) {
        const failure = adapter.classifyFailure(error)
        const { message, usage } = adapter.describeFailure(error)
        failedUsage = addUsage(failedUsage, usage)
        const wait =
          failure.kind === 'rate_limited' && failure.retryAfterSeconds !== undefined
            ? failure.retryAfterSeconds * 1000
            : Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt)
        const waits = failure.kind === 'rate_limited' || failure.kind === 'overloaded'
        if (waits && waitedMs + wait <= budgetMs) {
          runtime.onWait?.(wait, ran, failure.kind === 'rate_limited' ? 'a rate limit' : 'overload')
          const started = runtime.now()
          await runtime.sleep(wait)
          waitedMs += runtime.now() - started
          continue
        }
        const kind = harnessFailureKind(error, failure)
        const moveOn =
          waits || failure.kind === 'auth' || error instanceof HarnessRefusal || kind !== undefined
        if (!moveOn || last) {
          throw new StepFailure(
            message,
            failedUsage,
            kind === undefined ? ran : { ...ran, failure: kind },
            error,
          )
        }
        break
      }
    }
  }
  throw new Error('A step needs at least one model candidate.')
}

/**
 * A benchmark call: the request's own model on one harness (Claude unless `on` names another),
 * with the default wait budget and no fallback, so scores stay comparable.
 */
export function runFixedModel(
  request: HarnessRun,
  exec: Exec,
  on: { harness: string; readsOutsideCheckout?: true } = { harness: claude.name },
): Promise<HarnessResult> {
  const { model, ...rest } = request
  return runStep(rest, [{ ...on, model }], exec)
}

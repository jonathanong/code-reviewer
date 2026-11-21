import type { StepRan } from '../harness/runner.mts'
import type { Candidate } from '../harness/types.mts'
import { ReviewError } from './finding.mts'

/** The start of the message of a review stopped because its steps had spent the ceiling. */
export const CEILING_REACHED = 'cost ceiling reached'

/** What a review watches across its steps: progress on stderr, and the cost ceiling. */
export type StepWatch = {
  /** Writes one progress line; absent when progress is off. */
  write?: (line: string) => void
  now: () => number
  /** Total cost in US dollars at which no further step starts and the review stops; absent means no ceiling. */
  ceilingUsd?: number
  /** Cost the harnesses have reported so far; a step that reports none adds nothing. */
  spentUsd: number
  /** The first step the ceiling kept from starting; the review is stopped once this is set. */
  stopped?: CostCeilingReached
}

export function createStepWatch(options: {
  write?: (line: string) => void
  now: () => number
  ceilingUsd?: number
}): StepWatch {
  return {
    ...(options.write === undefined ? {} : { write: options.write }),
    now: options.now,
    ...(options.ceilingUsd === undefined ? {} : { ceilingUsd: options.ceilingUsd }),
    spentUsd: 0,
  }
}

type Costed = { costUsd: number | null }

const label = (step: string, on: Pick<Candidate, 'harness' | 'model'>) =>
  `${step} ${on.harness}:${on.model}`
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`
const dollars = (usd: number) => `$${usd.toFixed(2)}`

/**
 * The review stopped because the ceiling kept `step` from starting. It is not a harness's fault
 * and not worth an immediate retry: the same review would spend the same again.
 */
export class CostCeilingReached extends ReviewError {
  step: string
  spentUsd: number

  constructor(step: string, spentUsd: number, ceilingUsd: number) {
    super(
      `${CEILING_REACHED} (${dollars(spentUsd)} of ${dollars(ceilingUsd)}): ${step} did not start, so no review was produced`,
    )
    this.name = 'CostCeilingReached'
    this.step = step
    this.spentUsd = spentUsd
  }
}

/** Throws `CostCeilingReached` when the cost so far is at or above the ceiling. */
function checkCeiling(watch: StepWatch, step: string, first: Candidate): void {
  if (watch.ceilingUsd === undefined || watch.spentUsd < watch.ceilingUsd) return
  if (watch.stopped !== undefined) throw watch.stopped
  const stopped = new CostCeilingReached(step, watch.spentUsd, watch.ceilingUsd)
  watch.stopped = stopped
  watch.write?.(
    `code-reviewer: ${label(step, first)} not started, review stopped: ${stopped.message}\n`,
  )
  throw stopped
}

/**
 * A step that swallows its own failure (a pillar, the check, evidence) cannot hide the ceiling:
 * the review calls this after each of them and stops whole.
 */
export function throwIfStopped(watch: StepWatch | undefined): void {
  if (watch?.stopped !== undefined) throw watch.stopped
}

/** Reports a step's start and end, and adds what it cost to the review's total. */
export async function watchStep<T extends { ran: StepRan; usage: Costed }>(
  watch: StepWatch,
  step: string,
  first: Candidate,
  run: (onWait: (ms: number, on: StepRan, why: string) => void) => Promise<T>,
  describe: (error: unknown) => { message: string; usage: Costed | null; ran?: StepRan },
): Promise<T> {
  checkCeiling(watch, step, first)
  const started = watch.now()
  watch.write?.(`code-reviewer: ${label(step, first)} started\n`)
  const onWait = (ms: number, on: StepRan, why: string) =>
    watch.write?.(`code-reviewer: ${label(step, on)} waiting ${seconds(ms)} on ${why}\n`)
  try {
    const result = await run(onWait)
    const cost = result.usage.costUsd
    watch.spentUsd += cost ?? 0
    const price = cost === null ? '' : `, ${dollars(cost)}`
    const took = seconds(watch.now() - started)
    watch.write?.(`code-reviewer: ${label(step, result.ran)} done in ${took}${price}\n`)
    return result
  } catch (error) {
    const { message, usage, ran } = describe(error)
    watch.spentUsd += usage?.costUsd ?? 0
    const took = seconds(watch.now() - started)
    const line = message.split('\n')[0] as string
    watch.write?.(`code-reviewer: ${label(step, ran ?? first)} failed in ${took}: ${line}\n`)
    throw error
  }
}

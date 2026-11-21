import type { StepRan } from '../harness/runner.mts'
import type { Candidate } from '../harness/types.mts'

/** The start of the message of a step that never started because the review had spent its ceiling. */
export const CEILING_REACHED = 'cost ceiling reached'

/** What a review watches across its steps: progress on stderr, and the cost ceiling. */
export type StepWatch = {
  /** Writes one progress line; absent when progress is off. */
  write?: (line: string) => void
  now: () => number
  /** Total cost in US dollars after which no step starts; absent means no ceiling. */
  ceilingUsd?: number
  /** Cost the harnesses have reported so far; a step that reports none adds nothing. */
  spentUsd: number
  /** The reason of the first step the ceiling kept from starting. */
  skippedFor?: string
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

/** A step the review did not start: its message is the reason recorded for it. */
export class CeilingReached extends Error {}

/** Throws `CeilingReached` when the cost so far is at or above the ceiling. */
function checkCeiling(watch: StepWatch, step: string, first: Candidate): void {
  if (watch.ceilingUsd === undefined || watch.spentUsd < watch.ceilingUsd) return
  const reason = `${CEILING_REACHED} (${dollars(watch.spentUsd)} of ${dollars(watch.ceilingUsd)})`
  watch.skippedFor ??= reason
  watch.write?.(`code-reviewer: ${label(step, first)} skipped: ${reason}\n`)
  throw new CeilingReached(reason)
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

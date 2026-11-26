import type { ReviewDeps } from '../cli/deps.mts'
import type { PullTarget } from '../review/index.mts'
import { release } from './finish.mts'
import { RUN_EXIT, runLine, type RunLine } from './output.mts'

/** The `held` entry of a review the cost ceiling stopped; it is not a configurable hold rule. */
export const COST_CEILING_HOLD = 'cost-ceiling'

/**
 * A review the cost ceiling stopped produced nothing to post. Holds the pull request for a human
 * the way a held review is held: the claim is released with the held label set, so it stays in
 * `queue` and no other machine claims it. The tracker row says `failed` with the ceiling reason, which `preflight`
 * reads, so a later `run` of this head is a no-op and nothing retries it at the same cost.
 */
export async function holdAtCeiling(
  pull: PullTarget,
  deps: ReviewDeps,
  base: Partial<RunLine>,
  summary: Record<string, unknown>,
): Promise<RunLine> {
  const reason = summary.error as string
  const leftover = [
    summary.abortError as string | undefined,
    await release(pull, deps, 'hold'),
  ].filter((problem) => problem !== undefined)
  return runLine('held', RUN_EXIT.held, {
    ...base,
    held: [COST_CEILING_HOLD],
    reason,
    costUsd: summary.costUsd as number,
    problems: leftover,
    attention: [reason, ...leftover],
  })
}

import { CostCeilingReached } from '../step-watch.mts'
import { message, type ReviewSteps } from './review-support.mts'

/**
 * What `review` prints when it stops, after dropping the claim through `steps` (absent when a skip
 * already closed it). A review stopped by the cost ceiling also says so and carries what its steps
 * cost, so `run` can hold it and the tracker row keeps the spend.
 */
export async function failureSummary(
  error: unknown,
  steps: Pick<ReviewSteps, 'abort'> | undefined,
): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = { claimed: true, error: message(error) }
  if (error instanceof CostCeilingReached) {
    summary.costCeilingReached = true
    summary.costUsd = error.spentUsd
  }
  try {
    await steps?.abort(message(error))
  } catch (abortError) {
    summary.abortError = message(abortError)
  }
  return summary
}

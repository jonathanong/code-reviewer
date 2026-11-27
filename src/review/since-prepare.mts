import type { FollowUpContext } from './context.mts'
import type { PlanValues } from './plan-settings.mts'
import type { SinceDiff } from './plan.mts'
import type { PrepareIo } from './prepare-io.mts'
import { pathsChangingSql } from './sql-in-code.mts'
import { writeDiff, type Write } from './write-diff.mts'

/**
 * Compares the head with the last reviewed SHA, when there is one that is not the head. An ahead
 * since-diff is written under `since/`, and the source files whose changed lines are SQL are
 * recorded on it, so a small follow-up that edits a query is not light.
 */
export async function prepareSince(
  io: PrepareIo,
  out: string,
  write: Write,
  options: { context: FollowUpContext; headSha: string; values: PlanValues },
): Promise<{ since: SinceDiff | undefined; written: string[] }> {
  const { context, headSha, values } = options
  if (context.reviewedSha === null || context.reviewedSha === headSha) {
    return { since: undefined, written: [] }
  }
  const since = await io.compare(context.reviewedSha, headSha, values.generatedPaths)
  if (since.status !== 'ahead') return { since, written: [] }
  const patch = await io.compareDiff(context.reviewedSha, headSha)
  const sqlInCode = values.sqlInCode ? pathsChangingSql(patch, values.generatedPaths) : []
  return {
    since: sqlInCode.length === 0 ? since : { ...since, sqlInCode },
    written: writeDiff(out, 'since', patch, write),
  }
}

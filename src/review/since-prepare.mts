import type { FollowUpContext } from './context.mts'
import { DEFAULT_PLAN_VALUES } from './plan-settings.mts'
import type { PrepareOptions } from './prepare.mts'
import type { SinceDiff } from './plan.mts'
import type { PrepareIo } from './prepare-io.mts'
import { prepareSql, type SqlPrepare } from './sql-prepare.mts'
import { writeDiff, type Write } from './write-diff.mts'

/**
 * Compares the head with the last reviewed SHA, when there is one that is not the head. An ahead
 * since-diff is written under `since/`, and the SQL check runs on it (see `prepareSql`), so a small
 * follow-up that edits a query is not light. A first review has no since-diff: the check runs on
 * the whole pull request `patch` instead and is returned as `sql`.
 */
export async function prepareSince(
  io: PrepareIo,
  options: PrepareOptions,
  write: Write,
  diff: { context: FollowUpContext; headSha: string; patch: string },
): Promise<{ since: SinceDiff | undefined; written: string[]; sql: SqlPrepare }> {
  const { context, headSha, patch } = diff
  const values = options.values ?? DEFAULT_PLAN_VALUES
  const sqlInput = { values, rules: options.sqlRules, tree: options.tree }
  if (context.reviewedSha === null) {
    return {
      since: undefined,
      written: [],
      sql: await prepareSql(io, { ...sqlInput, patch, base: context.baseSha }),
    }
  }
  if (context.reviewedSha === headSha) return { since: undefined, written: [], sql: {} }
  const since = await io.compare(context.reviewedSha, headSha, values.generatedPaths)
  if (since.status !== 'ahead') return { since, written: [], sql: {} }
  const sincePatch = await io.compareDiff(context.reviewedSha, headSha)
  const sql = await prepareSql(io, { ...sqlInput, patch: sincePatch, base: context.reviewedSha })
  const written = writeDiff(options.out, 'since', sincePatch, write)
  return { since: { ...since, ...sql }, written, sql: {} }
}

import type { PlanValues } from './plan-settings.mts'
import type { PrepareIo } from './prepare-io.mts'
import { scanSqlPaths } from './sql-scan.mts'

export type SqlPrepare = {
  /** Source files whose changed lines are SQL by construction. */
  sqlInCode?: string[]
  /** Why the check did not run. */
  sqlSkipped?: string
}

/**
 * Runs the SQL-in-code check on `patch` when `plan.sqlInCode` is on and the ast-grep rules are
 * given; `base` is the commit the patch's removed lines come from.
 */
export async function prepareSql(
  io: PrepareIo,
  input: {
    values: PlanValues
    rules: string | undefined
    tree: string | undefined
    patch: string
    base: string
  },
): Promise<SqlPrepare> {
  const { values, rules } = input
  if (!values.sqlInCode || rules === undefined) return {}
  const scanned = await scanSqlPaths(
    { astGrep: (args) => io.astGrep(args), fileAt: (...at) => io.upgrades.fileAt(...at) },
    {
      patch: input.patch,
      tree: input.tree,
      base: input.base,
      config: rules,
      generatedPaths: values.generatedPaths,
    },
  )
  return {
    ...(scanned.paths.length === 0 ? {} : { sqlInCode: scanned.paths }),
    ...(scanned.skipped === undefined ? {} : { sqlSkipped: scanned.skipped }),
  }
}

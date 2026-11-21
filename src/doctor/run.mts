import { cloneCheck, configCheck, dirChecks } from './dir-checks.mts'
import { harnessChecks } from './harness-checks.mts'
import { pluginChecks } from './plugin-checks.mts'
import { mapBounded, reasonOf } from './pool.mts'
import { authChecks, binaryCheck, nodeCheck } from './system-checks.mts'
import type { Check, Context, DoctorResult } from './types.mts'

/** How many independent check groups run at once. */
const CONCURRENCY = 4

/** Each group is independent; one that throws becomes a fail rather than hiding the others. */
const GROUPS: Array<{ name: string; run: (ctx: Context) => Check[] | Promise<Check[]> }> = [
  { name: 'node', run: (ctx) => [nodeCheck(ctx)] },
  {
    name: 'tools',
    run: async ({ io }) => Promise.all([binaryCheck(io, 'git'), binaryCheck(io, 'gh')]),
  },
  { name: 'auth', run: authChecks },
  { name: 'machine-config', run: (ctx) => [configCheck(ctx)] },
  { name: 'rule-plugins', run: pluginChecks },
  { name: 'harness', run: ({ io }) => harnessChecks(io) },
  { name: 'dirs', run: dirChecks },
  { name: 'clone-root', run: async (ctx) => [await cloneCheck(ctx)] },
]

/** Runs every check without changing anything; results keep a fixed order. */
export async function runDoctor(ctx: Context): Promise<DoctorResult> {
  const groups = await mapBounded(GROUPS, CONCURRENCY, async (group): Promise<Check[]> => {
    try {
      return await group.run(ctx)
    } catch (error) {
      return [{ name: group.name, status: 'fail', detail: `check failed: ${reasonOf(error)}` }]
    }
  })
  const checks = groups.flat()
  const count = (status: Check['status']) =>
    checks.filter((check) => check.status === status).length
  return { ok: count('ok'), warn: count('warn'), fail: count('fail'), checks }
}

/** The human lines, one per check and an indented fix under a warn or fail. */
export function renderLines(result: DoctorResult): string[] {
  return result.checks.flatMap((check) => [
    `${check.status.padEnd(4)} ${check.name}: ${check.detail}`,
    ...(check.fix === undefined ? [] : [`     fix: ${check.fix}`]),
  ])
}

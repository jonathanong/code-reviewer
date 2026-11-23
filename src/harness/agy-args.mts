import { HarnessRefusal } from './refusal.mts'
import type { HarnessRun } from './types.mts'

/**
 * Throws before anything runs when the step needs what agy cannot confine. It has no flag that
 * names the tools a step may use or the directories it may read, so it cannot offer "no tools",
 * allow only some shell prefixes or web hosts, or keep reads inside the checkout. A step runs
 * only on a candidate the machine config marks `readsOutsideCheckout`. All of these are refused,
 * never loosened.
 */
export function assertAgyCan(request: HarnessRun): void {
  if (request.readsOutsideCheckout !== true) {
    throw new HarnessRefusal(`agy cannot confine: reads outside the checkout (${request.label})`)
  }
  if (!request.can.files) {
    throw new HarnessRefusal(`agy cannot confine: no-tools steps (${request.label})`)
  }
  if (request.can.shell.length > 0) {
    throw new HarnessRefusal(`agy cannot confine: shell prefixes (${request.label})`)
  }
  if (request.can.web.length > 0) {
    throw new HarnessRefusal(`agy cannot confine: web hosts (${request.label})`)
  }
}

/**
 * The `agy -p` argument list for one step. `--mode plan` is the most restrictive of agy's modes
 * (`accept-edits` and `auto` let it edit or run unprompted) and `--sandbox` restricts its
 * terminal. Neither `--dangerously-skip-permissions` nor `--mode auto` is ever passed, and
 * `--effort` takes the step's effort, which is never `max`.
 */
export function agyArgs(request: HarnessRun): string[] {
  const addDirs = request.addDirs ?? []
  return [
    '-p',
    request.prompt,
    '--model',
    request.model,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(request.schema),
    '--mode',
    'plan',
    '--sandbox',
    '--disable-slash-commands',
    ...(request.effort === undefined ? [] : ['--effort', request.effort]),
    ...addDirs.flatMap((dir) => ['--add-dir', dir]),
  ]
}

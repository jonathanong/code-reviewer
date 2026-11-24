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

/** Appended to every prompt: agy has no tool allowlist, and a shell attempt ends its turn empty. */
export const AGY_TOOL_NOTE =
  'Use only your file reading and search tools; do not run shell commands.'

const EFFORT_SUFFIX = /-(?:low|medium|high|xhigh)$/u

/**
 * The `agy -p` argument list for one step. What stops edits and commands is headless mode, which
 * cannot prompt and auto-denies any `command` or `edit` permission; `--sandbox` restricts its
 * terminal. `--mode plan` is not passed: it has no effect while `--disable-slash-commands` is
 * set (agy warns so on stderr). Neither `--dangerously-skip-permissions` nor `--mode auto` is
 * ever passed. `--effort` takes the step's effort, which is never `max`, except when the model id
 * already ends in an effort (`-low`, `-medium`, `-high`, `-xhigh`): agy rejects a flag that
 * disagrees with the id, so the configured model's own effort wins and no flag is passed.
 */
export function agyArgs(request: HarnessRun): string[] {
  const addDirs = request.addDirs ?? []
  return [
    '-p',
    `${request.prompt}\n\n${AGY_TOOL_NOTE}`,
    '--model',
    request.model,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(request.schema),
    '--sandbox',
    '--disable-slash-commands',
    ...(request.effort === undefined || EFFORT_SUFFIX.test(request.model)
      ? []
      : ['--effort', request.effort]),
    ...addDirs.flatMap((dir) => ['--add-dir', dir]),
  ]
}

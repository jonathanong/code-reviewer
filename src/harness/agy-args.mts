import { HarnessRefusal } from './refusal.mts'
import type { HarnessRun } from './types.mts'

/**
 * Throws before anything runs when the step needs what agy cannot confine. It has no flag that
 * names the tools a step may use or the directories it may read, so it cannot offer "no tools",
 * allow only some shell prefixes, or keep reads inside the checkout. A step runs only on a
 * candidate the machine config marks `readsOutsideCheckout`. Those are refused, never loosened.
 * Web hosts are allowed: `agyArgs` confines the network to them and the review's reference hosts. A host that is not a plain
 * hostname is refused, since it would otherwise be written into a permission rule.
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
  for (const host of allowedHosts(request)) {
    if (!PLAIN_HOSTNAME.test(host)) {
      throw new HarnessRefusal(
        `agy cannot confine: web host ${JSON.stringify(host)} (${request.label})`,
      )
    }
  }
}

/** A dotted hostname: no wildcard, scheme, port, path, space or parenthesis. */
const PLAIN_HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/iu

/** Every host the network allowlist holds: the review's reference hosts and this step's own, once each. */
function allowedHosts(request: HarnessRun): string[] {
  return [...new Set([...(request.referenceDomains ?? []), ...request.can.web])]
}

/**
 * Turns on agy's outbound allowlist while allowing nothing. Any `read_url` rule enables the
 * allowlist; `.invalid` is a reserved TLD that never resolves. Checked by hand with agy 1.5.17:
 * with only this rule, `curl https://example.com` is blocked.
 */
const PLACEHOLDER_RULE = 'read_url(invalid)'

/** Appended to every prompt: agy has no tool allowlist, and a shell attempt ends its turn empty. */
export const AGY_TOOL_NOTE =
  'Use only your file reading and search tools; do not run shell commands.'

/** The note for a step granted web hosts: curl on those hosts is the one shell use allowed. */
export function agyToolNote(web: readonly string[]): string {
  return web.length === 0
    ? AGY_TOOL_NOTE
    : `Use your file reading and search tools. To read documentation you may run \`curl -sL <https URL>\` for these hosts only: ${web.join(', ')}. Run no other shell command.`
}

/** The session-only `--settings` JSON: one `read_url` allow rule per allowed host. */
function agySettings(hosts: readonly string[]): string {
  const allow = hosts.length === 0 ? [PLACEHOLDER_RULE] : hosts.map((host) => `read_url(${host})`)
  return JSON.stringify({ permissions: { allow } })
}

const EFFORT_SUFFIX = /-(?:low|medium|high|xhigh)$/u

/**
 * The `agy -p` argument list for one step. Headless mode does not deny commands. What confines
 * agy is `--sandbox`, which limits the filesystem, plus the network allowlist that `--settings`
 * turns on for every step (see `PLACEHOLDER_RULE`), so a step reaches only the review's reference hosts and its own web hosts.
 * `--mode plan` is not passed: it has no effect while `--disable-slash-commands` is
 * set (agy warns so on stderr). Neither `--dangerously-skip-permissions` nor `--mode auto` is
 * ever passed. `--effort` takes the step's effort, which is never `max`, except when the model id
 * already ends in an effort (`-low`, `-medium`, `-high`, `-xhigh`): agy rejects a flag that
 * disagrees with the id, so the configured model's own effort wins and no flag is passed.
 */
export function agyArgs(request: HarnessRun): string[] {
  const addDirs = request.addDirs ?? []
  return [
    '-p',
    `${request.prompt}\n\n${agyToolNote(request.can.web)}`,
    '--model',
    request.model,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(request.schema),
    '--sandbox',
    '--settings',
    agySettings(allowedHosts(request)),
    '--disable-slash-commands',
    ...(request.effort === undefined || EFFORT_SUFFIX.test(request.model)
      ? []
      : ['--effort', request.effort]),
    ...addDirs.flatMap((dir) => ['--add-dir', dir]),
  ]
}

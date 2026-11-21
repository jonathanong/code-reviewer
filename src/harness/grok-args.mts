import { HarnessRefusal } from './refusal.mts'
import type { HarnessRun } from './types.mts'

const READ_TOOLS = 'read_file,list_dir,grep'
/** The gateway to the user's MCP servers; never offered. */
const GATEWAY_TOOLS = 'search_tool,use_tool'

/** Switches that stop Grok loading the user's Claude and Cursor skills, rules, MCP servers, hooks and agents. */
export const GROK_ENV: Record<string, string> = Object.fromEntries(
  ['CLAUDE', 'CURSOR'].flatMap((product) =>
    ['SKILLS', 'RULES', 'MCPS', 'HOOKS', 'AGENTS'].map((kind) => [
      `GROK_${product}_${kind}_ENABLED`,
      '0',
    ]),
  ),
)

/**
 * Throws before anything runs when the step needs what Grok cannot confine. Grok has no proven
 * way to allow only some shell prefixes or some web hosts, so those are refused, never loosened.
 */
export function assertGrokCan(request: HarnessRun): void {
  if (request.can.shell.length > 0) {
    throw new HarnessRefusal(`grok cannot confine: shell prefixes (${request.label})`)
  }
  if (request.can.web.length > 0) {
    throw new HarnessRefusal(`grok cannot confine: web hosts (${request.label})`)
  }
}

/** The `grok -p` argument list for one step: read tools only, no gateway, no subagents, no web search. */
export function grokArgs(request: HarnessRun): string[] {
  const addDirs = request.addDirs ?? []
  return [
    '-p',
    request.prompt,
    '-m',
    request.model,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(request.schema),
    '--tools',
    request.can.files ? READ_TOOLS : '',
    '--disallowed-tools',
    GATEWAY_TOOLS,
    '--permission-mode',
    'dontAsk',
    '--max-turns',
    String(request.maxTurns),
    '--no-subagents',
    '--disable-web-search',
    ...(request.effort === undefined ? [] : ['--reasoning-effort', request.effort]),
    ...addDirs.flatMap((dir) => ['--add-dir', dir]),
  ]
}

import { HarnessRefusal } from './refusal.mts'
import type { HarnessRun } from './types.mts'

const READ_PERMISSIONS = { read: 'allow', grep: 'allow', glob: 'allow', list: 'allow' }

/**
 * Throws before anything runs when the step needs what OpenCode cannot confine. Its permissions
 * have no proven way to allow only some shell prefixes or web hosts, so those are refused.
 */
export function assertOpencodeCan(request: HarnessRun): void {
  if (request.can.shell.length > 0) {
    throw new HarnessRefusal(`opencode cannot confine: shell prefixes (${request.label})`)
  }
  if (request.can.web.length > 0) {
    throw new HarnessRefusal(`opencode cannot confine: web hosts (${request.label})`)
  }
}

/** Reads outside the working directory are allowed for exactly these directories and nothing else. */
function externalDirectories(dirs: readonly string[]): Record<string, string> {
  const rules: Record<string, string> = { '*': 'deny' }
  for (const dir of dirs) {
    const root = dir.replace(/\/+$/, '')
    rules[root] = 'allow'
    rules[`${root}/**`] = 'allow'
  }
  return rules
}

/**
 * The environment that confines a step: every tool denied except the read tools it may use, and
 * reads outside the working directory denied except in `addDirs`. Writes stay denied by `*`.
 */
export function opencodeEnv(request: HarnessRun): Record<string, string> {
  const dirs = request.addDirs ?? []
  const permission = {
    '*': 'deny',
    ...(request.can.files ? READ_PERMISSIONS : {}),
    ...(request.can.files && dirs.length > 0
      ? { external_directory: externalDirectories(dirs) }
      : {}),
  }
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission }) }
}

/** The prompt, followed by the instruction that stands in for a schema flag OpenCode lacks. */
export function opencodePrompt(request: HarnessRun): string {
  return [
    request.prompt,
    '',
    'Reply with only one JSON object matching this JSON schema. No prose and no code fence.',
    JSON.stringify(request.schema),
  ].join('\n')
}

/** The `opencode run` argument list for one step. */
export function opencodeArgs(request: HarnessRun): string[] {
  return [
    'run',
    opencodePrompt(request),
    '-m',
    request.model,
    '--format',
    'json',
    '--pure',
    // The only place OpenCode reports its free usage limit is the log; stdout stays empty.
    '--print-logs',
    '--log-level',
    'ERROR',
    ...(request.effort === undefined ? [] : ['--variant', request.effort]),
  ]
}

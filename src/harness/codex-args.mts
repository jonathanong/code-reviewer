import { HarnessRefusal } from './refusal.mts'
import type { HarnessRun } from './types.mts'

/**
 * Throws before anything runs when the step needs what Codex cannot confine. Codex reads files
 * through its one shell tool, so it cannot offer "no tools", nor allow only some shell prefixes
 * or web hosts; those are refused, never loosened.
 */
export function assertCodexCan(request: HarnessRun): void {
  if (!request.can.files) {
    throw new HarnessRefusal(`codex cannot confine: no-tools steps (${request.label})`)
  }
  if (request.can.shell.length > 0) {
    throw new HarnessRefusal(`codex cannot confine: shell prefixes (${request.label})`)
  }
  if (request.can.web.length > 0) {
    throw new HarnessRefusal(`codex cannot confine: web hosts (${request.label})`)
  }
}

/** Where `codex exec` reads the schema from and writes the final message to. */
export type CodexFiles = { schema: string; lastMessage: string }

/**
 * The `codex exec` argument list for one step. The sandbox is always `read-only`, which also
 * lets the step read the run directory, so `addDirs` is not passed: Codex's `--add-dir` grants
 * write access. The prompt follows `--` so one that starts with a dash is not read as a flag.
 */
export function codexArgs(request: HarnessRun, files: CodexFiles): string[] {
  return [
    'exec',
    '-m',
    request.model,
    '-s',
    'read-only',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--output-schema',
    files.schema,
    '-o',
    files.lastMessage,
    '-c',
    'web_search="disabled"',
    ...(request.effort === undefined ? [] : ['-c', `model_reasoning_effort="${request.effort}"`]),
    '--',
    request.prompt,
  ]
}

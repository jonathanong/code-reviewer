import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertCodexCan, codexArgs } from './codex-args.mts'
import { dropOptionalNulls, strictSchema } from './codex-schema.mts'
import { codexUsage, describeCodexFailure, readCodexAnswer } from './codex-output.mts'
import type { FailureClass, Harness, HarnessResult, HarnessRun } from './types.mts'

const BINARY = 'codex'
// A usage limit resets in hours, longer than any wait budget, so the step moves to its next candidate.
const LIMIT_RETRY_SECONDS = 3600
const RATE_LIMITED = /\b(usage limit|rate.?limit(ed)?|too many requests|429)\b/iu
const AUTH = /\b(not logged in|unauthorized|401|invalid api key)\b/iu

/**
 * Codex, run headless with `codex exec --json`. It runs read-only steps in its `read-only`
 * sandbox, with the user's config and rules not loaded and web search off. It refuses no-tools
 * steps and shell and web grants it cannot confine, and ignores `explorer`, `skills`,
 * `settings`, `transcript`, `addDirs` (the sandbox already reads them) and `maxTurns`. Run against
 * `codex-cli 0.171.0` on a small read-only step; no real failure has been captured.
 */
export const harness: Harness = {
  name: 'codex',
  assertCan: assertCodexCan,
  async run(request: HarnessRun, exec): Promise<HarnessResult> {
    assertCodexCan(request)
    const dir = mkdtempSync(join(tmpdir(), 'codex-step-'))
    try {
      const files = { schema: join(dir, 'schema.json'), lastMessage: join(dir, 'last.txt') }
      writeFileSync(files.schema, JSON.stringify(strictSchema(request.schema)))
      const stdout = await exec(BINARY, codexArgs(request, files), {
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        ...(request.env === undefined ? {} : { env: request.env }),
      })
      const last = readLast(files.lastMessage)
      const usage = codexUsage(stdout, request.model)
      const answer = readCodexAnswer(stdout, last, request.label, usage)
      const structured = dropOptionalNulls(answer, request.schema)
      return { structured, skills: [], reads: [], searches: [], usage, reportedUsage: usage }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  describeFailure: describeCodexFailure,
  classifyFailure,
}

/** Classified from the failure's message alone: no real Codex error has been captured yet. */
function classifyFailure(error: unknown): FailureClass {
  const message = error instanceof Error ? error.message : ''
  if (RATE_LIMITED.test(message)) {
    return { kind: 'rate_limited', retryAfterSeconds: LIMIT_RETRY_SECONDS }
  }
  if (AUTH.test(message)) return { kind: 'auth' }
  return { kind: 'other' }
}

function readLast(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

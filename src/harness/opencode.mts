import { assertOpencodeCan, opencodeArgs, opencodeEnv } from './opencode-args.mts'
import { describeOpencodeFailure, readOpencodeResult } from './opencode-output.mts'
import type { FailureClass, Harness, HarnessResult, HarnessRun } from './types.mts'

const BINARY = 'opencode'

/**
 * OpenCode, run headless with `opencode run`. It runs read-only steps: files and no tools. It
 * refuses shell and web grants it cannot confine, and ignores `explorer`, `skills`, `settings`,
 * `addDirs`, `transcript` and `maxTurns`.
 */
export const harness: Harness = {
  name: 'opencode',
  async run(request: HarnessRun, exec): Promise<HarnessResult> {
    assertOpencodeCan(request)
    const stdout = await exec(BINARY, opencodeArgs(request), {
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      env: { ...request.env, ...opencodeEnv(request) },
    })
    return readOpencodeResult(stdout, request)
  },
  describeFailure: describeOpencodeFailure,
  classifyFailure,
}

const FREE_LIMIT = 'Free usage limit reached'
// The free limit is a quota, not a burst limit: longer than any wait budget, so the step moves on.
const FREE_LIMIT_RETRY_SECONDS = 3600

/**
 * At its free usage limit OpenCode logs the error, prints nothing and hangs until the step's
 * timeout kills it, so the limit is read from the log tail the failure carries. No other
 * rate-limit or auth error has been captured, so nothing else is retried on a guess.
 */
function classifyFailure(error: unknown): FailureClass {
  if (error instanceof Error && error.message.includes(FREE_LIMIT)) {
    return { kind: 'rate_limited', retryAfterSeconds: FREE_LIMIT_RETRY_SECONDS }
  }
  return { kind: 'other' }
}

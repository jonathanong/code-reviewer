import { assertOpencodeCan, opencodeArgs, opencodeEnv } from './opencode-args.mts'
import { describeOpencodeFailure, readOpencodeResult } from './opencode-output.mts'
import type { Harness, HarnessResult, HarnessRun } from './types.mts'

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
  // No rate-limit or auth error from OpenCode has been captured, so nothing is retried on a guess.
  classifyFailure: () => ({ kind: 'other' }),
}

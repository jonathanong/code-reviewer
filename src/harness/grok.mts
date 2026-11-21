import { assertGrokCan, GROK_ENV, grokArgs } from './grok-args.mts'
import { describeGrokFailure, readGrokResult } from './grok-output.mts'
import type { Harness, HarnessResult, HarnessRun } from './types.mts'

const BINARY = 'grok'

/**
 * Grok, run headless with `grok -p`. It runs read-only steps: files and no tools. It refuses
 * shell and web grants it cannot confine, and ignores `explorer`, `skills` and `settings`.
 */
export const harness: Harness = {
  name: 'grok',
  async run(request: HarnessRun, exec): Promise<HarnessResult> {
    assertGrokCan(request)
    const stdout = await exec(BINARY, grokArgs(request), {
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      env: { ...request.env, ...GROK_ENV },
    })
    return readGrokResult(stdout, request.label)
  },
  describeFailure: describeGrokFailure,
}

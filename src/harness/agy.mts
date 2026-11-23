import { agyArgs, assertAgyCan } from './agy-args.mts'
import { describeAgyFailure, readAgyResult } from './agy-output.mts'
import type { FailureClass, Harness, HarnessResult, HarnessRun } from './types.mts'

const BINARY = 'agy'
const NOT_LOGGED_IN = 'not logged into Antigravity'

/**
 * Google's Antigravity CLI, run headless with `agy -p` in `--mode plan` and `--sandbox`. It
 * runs read-only steps on a candidate marked `readsOutsideCheckout`, and refuses no-tools steps
 * and shell and web grants it cannot confine. It ignores `explorer`, `skills`, `settings`,
 * `transcript` and `maxTurns`.
 */
export const harness: Harness = {
  name: 'agy',
  assertCan: assertAgyCan,
  async run(request: HarnessRun, exec): Promise<HarnessResult> {
    assertAgyCan(request)
    const stdout = await exec(BINARY, agyArgs(request), {
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      ...(request.env === undefined ? {} : { env: request.env }),
    })
    return readAgyResult(stdout, request.label)
  },
  describeFailure: describeAgyFailure,
  classifyFailure,
}

/** Only agy's sign-in message has been captured; nothing else is classified on a guess. */
function classifyFailure(error: unknown): FailureClass {
  return error instanceof Error && error.message.includes(NOT_LOGGED_IN)
    ? { kind: 'auth' }
    : { kind: 'other' }
}

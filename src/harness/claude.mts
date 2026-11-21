import { claudeArgs } from './claude-args.mts'
import { readResult, readTranscript } from './claude-stream.mts'
import { describeFailure } from './claude-usage.mts'
import type { Harness, HarnessResult, HarnessRun } from './types.mts'

const BINARY = 'claude'

/** Claude Code, run headless with `claude -p`. */
export const harness: Harness = {
  name: 'claude',
  async run(request: HarnessRun, exec): Promise<HarnessResult> {
    const options = {
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      ...(request.env === undefined ? {} : { env: request.env }),
    }
    const args = claudeArgs(request)
    const stdout =
      Object.keys(options).length === 0
        ? await exec(BINARY, args)
        : await exec(BINARY, args, options)
    return request.transcript === true ? readTranscript(stdout, request.label) : readResult(stdout)
  },
  describeFailure,
}

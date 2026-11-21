import { vi } from 'vitest'

import { ExecError } from '../benchmark/exec.mts'
import { resolveModelPlan, type StepModels } from '../models.mts'

const claude = (model: string) => ({ harness: 'claude', model })

/** `step` runs on model `a`, then on model `b`; no wait budget, so a rate limit falls back at once. */
export function fallbackModels(step: string): StepModels {
  return {
    plan: resolveModelPlan({
      steps: { [step]: [claude('a'), claude('b')] },
      retry: { maxWaitSeconds: 0 },
    }),
    clock: { sleep: async () => {}, now: () => 0 },
  }
}

const limited = (status: number) =>
  new ExecError(
    'claude exited with 1',
    1,
    JSON.stringify({ type: 'result', is_error: true, api_error_status: status }),
    undefined,
  )

/** An exec that answers with `answer`, except that the `limitedModels` fail with an API status. */
export function limitedExec(answer: string, limitedModels: readonly string[], status = 429) {
  return vi.fn(async (_command: string, args: string[]) => {
    const model = args[args.indexOf('--model') + 1] as string
    if (limitedModels.includes(model)) throw limited(status)
    return answer
  })
}

/** The models the calls of `exec` asked for, in order. */
export const modelsOf = (exec: ReturnType<typeof limitedExec>) =>
  exec.mock.calls.map((call) => call[1][call[1].indexOf('--model') + 1])

/** `step` lists no model at all, so the step fails before any model is asked. */
export function noModels(step: string): StepModels {
  return { plan: resolveModelPlan({ steps: { [step]: [] } }) }
}

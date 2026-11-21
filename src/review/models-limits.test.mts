import { describe, expect, it, vi } from 'vitest'

import { NO_TOOLS } from '../harness/types.mts'
import { DEFAULT_MODEL_PLAN, runModelStep, type StepModels } from './models.mts'
import { RUN_TIMEOUT_MS, SELECT_TIMEOUT_MS } from './run/types.mts'

const answer = JSON.stringify({ type: 'result', total_cost_usd: 0, structured_output: {} })

/** Runs `step` with a request that asks for `asked` and returns the timeout the harness got. */
async function timeoutFor(step: string, asked: number, models: StepModels) {
  const exec = vi.fn(async (..._args: unknown[]) => answer)
  await runModelStep(
    models,
    { keys: [step], fallback: 'small' },
    { prompt: 'p', label: 'Step', maxTurns: 1, schema: {}, can: NO_TOOLS, timeoutMs: asked },
    exec as never,
  )
  const options = exec.mock.calls[0]?.[2] as { timeoutMs?: number } | undefined
  return options?.timeoutMs
}

describe('runModelStep with limits', () => {
  it('keeps the step own timeout when no limit is set', async () => {
    expect(await timeoutFor('verifier', RUN_TIMEOUT_MS, { plan: DEFAULT_MODEL_PLAN })).toBe(
      RUN_TIMEOUT_MS,
    )
    expect(await timeoutFor('select', SELECT_TIMEOUT_MS, { plan: DEFAULT_MODEL_PLAN })).toBe(
      SELECT_TIMEOUT_MS,
    )
  })

  it('gives the select step its own limit and every other step the run limit', async () => {
    const models = {
      plan: DEFAULT_MODEL_PLAN,
      limits: { runTimeoutMs: 600_000, selectTimeoutMs: 30_000 },
    }
    expect(await timeoutFor('select', SELECT_TIMEOUT_MS, models)).toBe(30_000)
    expect(await timeoutFor('verifier', RUN_TIMEOUT_MS, models)).toBe(600_000)
    expect(await timeoutFor('pillar.rules', RUN_TIMEOUT_MS, models)).toBe(600_000)
  })
})

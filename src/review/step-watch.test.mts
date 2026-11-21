import { describe, expect, it } from 'vitest'

import { ExecError } from './benchmark/exec.mts'
import { resolveModelPlan, runModelStep, type StepModels } from './models.mts'
import { CeilingReached, createStepWatch } from './step-watch.mts'

const claude = (model: string) => ({ harness: 'claude', model })
const REQUEST = {
  prompt: 'p',
  label: 'Step',
  maxTurns: 1,
  schema: {},
  can: { files: false, skills: false, explorer: false, shell: [], web: [] },
}
const STEP = { keys: ['select'], fallback: 'small' } as const

const answer = (cost: number | null) =>
  JSON.stringify({
    type: 'result',
    ...(cost === null ? {} : { total_cost_usd: cost }),
    structured_output: {},
  })

const failed = (event: object) =>
  new ExecError('x', 1, JSON.stringify({ type: 'result', is_error: true, ...event }), '')

/** A clock that moves one second per read. */
function ticking() {
  let ms = 0
  return () => {
    ms += 1000
    return ms
  }
}

function watched(options: { ceilingUsd?: number; quiet?: boolean; steps?: object } = {}) {
  const lines: string[] = []
  const watch = createStepWatch({
    ...(options.quiet === true ? {} : { write: (line: string) => void lines.push(line) }),
    now: ticking(),
    ...(options.ceilingUsd === undefined ? {} : { ceilingUsd: options.ceilingUsd }),
  })
  const models: StepModels = {
    plan: resolveModelPlan({
      steps: { select: [claude('a')], ...options.steps },
      retry: { maxWaitSeconds: 600 },
    }),
    clock: { sleep: async () => {}, now: ticking() },
    watch,
  }
  return { lines, watch, models }
}

describe('progress lines', () => {
  it('writes a start line and an end line with the elapsed seconds and the cost', async () => {
    const { lines, models } = watched()
    await runModelStep(models, STEP, REQUEST, async () => answer(0.125))
    expect(lines).toEqual([
      'code-reviewer: select claude:a started\n',
      'code-reviewer: select claude:a done in 1.0s, $0.13\n',
    ])
  })

  it('leaves the cost out when the harness reported none', async () => {
    const { lines, models } = watched()
    await runModelStep(models, STEP, REQUEST, async () => answer(null))
    expect(lines[1]).toBe('code-reviewer: select claude:a done in 1.0s\n')
  })

  it('names the model that ran, after a fallback', async () => {
    const { lines, models } = watched({ steps: { select: [claude('a'), claude('b')] } })
    const exec = async (_command: string, args: string[]) => {
      if (args[args.indexOf('--model') + 1] === 'a') throw failed({ api_error_status: 401 })
      return answer(0.5)
    }
    await runModelStep(models, STEP, REQUEST, exec)
    expect(lines).toEqual([
      'code-reviewer: select claude:a started\n',
      'code-reviewer: select claude:b done in 1.0s, $0.50\n',
    ])
  })

  it('writes the first line of a failure', async () => {
    const { lines, models } = watched()
    await expect(
      runModelStep(models, STEP, REQUEST, async () => {
        throw new Error('boom\nsecond line')
      }),
    ).rejects.toThrow('boom')
    expect(lines).toEqual([
      'code-reviewer: select claude:a started\n',
      'code-reviewer: select claude:a failed in 1.0s: boom\n',
    ])
  })

  it('writes a line when a step waits on a rate limit, and on overload', async () => {
    const { lines, models } = watched()
    const failures = [failed({ api_error_status: 429 }), failed({ api_error_status: 529 })]
    await runModelStep(models, STEP, REQUEST, async () => {
      const next = failures.shift()
      if (next !== undefined) throw next
      return answer(0.5)
    })
    expect(lines.filter((line) => line.includes('waiting'))).toEqual([
      'code-reviewer: select claude:a waiting 5.0s on a rate limit\n',
      'code-reviewer: select claude:a waiting 10.0s on overload\n',
    ])
  })

  it('writes nothing with --quiet, and still enforces the ceiling', async () => {
    const { lines, models } = watched({ quiet: true, ceilingUsd: 1 })
    await runModelStep(models, STEP, REQUEST, async () => answer(1))
    await expect(runModelStep(models, STEP, REQUEST, async () => answer(1))).rejects.toThrow(
      CeilingReached,
    )
    expect(lines).toEqual([])
  })

  it('reports a failure that carries no run under the first candidate', async () => {
    const { lines, models } = watched({ steps: { select: [{ harness: 'nope', model: 'a' }] } })
    await expect(runModelStep(models, STEP, REQUEST, async () => answer(1))).rejects.toThrow(
      TypeError,
    )
    expect(lines.at(-1)).toContain('select nope:a failed in 1.0s: ')
  })

  it('leaves a step with no candidate to fail as it always did', async () => {
    const { lines, models } = watched({ steps: { select: [] } })
    await expect(runModelStep(models, STEP, REQUEST, async () => answer(1))).rejects.toThrow(
      'at least one model candidate',
    )
    expect(lines).toEqual([])
  })

  it('runs with no watch at all', async () => {
    const { models } = watched()
    const bare: StepModels = { plan: models.plan }
    await expect(runModelStep(bare, STEP, REQUEST, async () => answer(1))).resolves.toBeDefined()
  })
})

describe('cost ceiling', () => {
  it('has no ceiling by default: every step starts however much has been spent', async () => {
    const { models, watch } = watched()
    for (let step = 0; step < 3; step += 1) {
      await runModelStep(models, STEP, REQUEST, async () => answer(100))
    }
    expect(watch.spentUsd).toBe(300)
    expect(watch.skippedFor).toBeUndefined()
  })

  it('starts a step while the cost so far is under the ceiling', async () => {
    const { models, watch } = watched({ ceilingUsd: 1 })
    await runModelStep(models, STEP, REQUEST, async () => answer(0.99))
    await runModelStep(models, STEP, REQUEST, async () => answer(0.5))
    expect(watch.spentUsd).toBeCloseTo(1.49)
    expect(watch.skippedFor).toBeUndefined()
  })

  it('does not start a step once the cost so far is at the ceiling, and says why', async () => {
    const { lines, models, watch } = watched({ ceilingUsd: 1 })
    await runModelStep(models, STEP, REQUEST, async () => answer(1))
    let started = 0
    const exec = async () => {
      started += 1
      return answer(1)
    }
    await expect(runModelStep(models, STEP, REQUEST, exec)).rejects.toThrow(
      'cost ceiling reached ($1.00 of $1.00)',
    )
    expect(started).toBe(0)
    expect(watch.skippedFor).toBe('cost ceiling reached ($1.00 of $1.00)')
    expect(lines.at(-1)).toBe(
      'code-reviewer: select claude:a skipped: cost ceiling reached ($1.00 of $1.00)\n',
    )
  })

  it('counts a step that reports no cost as zero', async () => {
    const { models, watch } = watched({ ceilingUsd: 0.01 })
    await runModelStep(models, STEP, REQUEST, async () => answer(null))
    await runModelStep(models, STEP, REQUEST, async () => answer(null))
    expect(watch.spentUsd).toBe(0)
  })

  it('counts what a failed step reported', async () => {
    const { models, watch } = watched({ ceilingUsd: 1 })
    await expect(
      runModelStep(models, STEP, REQUEST, async () => {
        throw failed({ total_cost_usd: 2 })
      }),
    ).rejects.toThrow()
    expect(watch.spentUsd).toBe(2)
    await expect(runModelStep(models, STEP, REQUEST, async () => answer(1))).rejects.toThrow(
      CeilingReached,
    )
  })
})

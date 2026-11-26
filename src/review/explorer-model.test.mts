import { describe, expect, it } from 'vitest'

import { READ_ONLY } from '../harness/types.mts'
import { explorerModelFor } from './explorer-model.mts'
import { DEFAULT_MODEL_PLAN, resolveModelPlan, runModelStep } from './models.mts'

const claude = (model: string) => ({ harness: 'claude', model })

describe('explorerModelFor', () => {
  it('is the small tier first Claude candidate, skipping other harnesses, else haiku', () => {
    const plan = (small: { harness: string; model: string }[]) =>
      resolveModelPlan({ tiers: { small } })
    expect(explorerModelFor(DEFAULT_MODEL_PLAN)).toBe('haiku')
    expect(explorerModelFor(plan([claude('sonnet'), claude('haiku')]))).toBe('sonnet')
    expect(explorerModelFor(plan([{ harness: 'codex', model: 'g' }, claude('opus')]))).toBe('opus')
    expect(explorerModelFor(plan([{ harness: 'codex', model: 'g' }]))).toBe('haiku')
  })
})

describe('explorerModelFor in a step run', () => {
  it('reaches the claude subagent definition of a step run', async () => {
    const seen: string[][] = []
    const exec = async (_command: string, args: string[]) => {
      seen.push(args)
      return JSON.stringify({ type: 'result', structured_output: 1 })
    }
    const plan = resolveModelPlan({ tiers: { small: [claude('sonnet')] } })
    const request = {
      prompt: 'P',
      label: 'S',
      maxTurns: 1,
      schema: {},
      can: { ...READ_ONLY, explorer: true },
    }
    await runModelStep({ plan }, { keys: ['select'], fallback: 'medium' }, request, exec)
    const [args] = seen as [string[]]
    const agents = JSON.parse(args[args.indexOf('--agents') + 1] as string)
    expect(agents.explorer.model).toBe('sonnet')
  })
})

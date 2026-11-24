import { describe, expect, it } from 'vitest'

import { READ_ONLY } from '../harness/types.mts'
import {
  DEFAULT_MODEL_PLAN,
  DEFAULT_STEP_MODELS,
  DEFAULT_TIERS,
  candidatesFor,
  modelTable,
  parseModelOverrides,
  resolveModelPlan,
  runModelStep,
  stepKeys,
  tierOfPlanned,
} from './models.mts'

const claude = (model: string) => ({ harness: 'claude', model })

describe('candidatesFor', () => {
  it('resolves an unset step to the default tier it is given', () => {
    expect(candidatesFor(DEFAULT_MODEL_PLAN, ['pillars'], 'medium')).toEqual([claude('sonnet')])
    expect(candidatesFor(DEFAULT_MODEL_PLAN, ['verifier'], 'large')).toEqual([claude('opus')])
  })

  it('maps the planned model names to the default tiers', () => {
    expect(['haiku', 'sonnet', 'opus'].map((m) => tierOfPlanned(m as 'haiku'))).toEqual([
      'small',
      'medium',
      'large',
    ])
  })

  it('takes the most specific set key, a tier name or its own list', () => {
    const plan = resolveModelPlan({
      steps: { pillars: 'large', 'pillar.design': [claude('x'), claude('y')] },
    })
    expect(candidatesFor(plan, ['pillar.design', 'pillars'], 'medium')).toEqual([
      claude('x'),
      claude('y'),
    ])
    expect(candidatesFor(plan, ['pillar.rules', 'pillars'], 'medium')).toEqual([claude('opus')])
  })
})

describe('resolveModelPlan', () => {
  it('is the defaults for no config', () => {
    expect(resolveModelPlan(undefined)).toEqual(DEFAULT_MODEL_PLAN)
    expect(DEFAULT_MODEL_PLAN.tiers).toBe(DEFAULT_TIERS)
  })

  it('replaces only the keys a config sets', () => {
    const plan = resolveModelPlan({
      tiers: { small: [claude('other')] },
      retry: { maxWaitSeconds: 5 },
    })
    expect(plan.tiers).toEqual({ ...DEFAULT_TIERS, small: [claude('other')] })
    expect(plan.retry).toEqual({ maxWaitSeconds: 5 })
    expect(plan.steps).toEqual({})
  })

  it('lets overrides win over the config for the steps they name', () => {
    const plan = resolveModelPlan(
      { steps: { select: 'large', evidence: 'small' } },
      { select: [claude('z')] },
    )
    expect(plan.steps).toEqual({ select: [claude('z')], evidence: 'small' })
  })
})

describe('parseModelOverrides', () => {
  it('reads step=harness:model, keeping a model name that holds colons', () => {
    expect(parseModelOverrides(['verifier=claude:opus', 'pillar.design=claude:a:b'])).toEqual({
      verifier: [claude('opus')],
      'pillar.design': [claude('a:b')],
    })
  })

  it('gives a step named twice its candidates in flag order', () => {
    expect(parseModelOverrides(['select=claude:a', 'select=claude:b'])).toEqual({
      select: [claude('a'), claude('b')],
    })
  })

  it.each(['verifier', 'verifier=opus', '=claude:opus', 'verifier=claude:', 'verifier=claude=x'])(
    'rejects the malformed %s',
    (value) => {
      expect(() => parseModelOverrides([value])).toThrow('expected step=harness:model')
    },
  )

  it('accepts a step for a configured pillar, but not a malformed one', () => {
    expect(parseModelOverrides(['pillar.a11y=claude:opus'])).toEqual({
      'pillar.a11y': [claude('opus')],
    })
    expect(() => parseModelOverrides(['pillar.Bad_Name=claude:a'])).toThrow('unknown step')
  })

  it('rejects an unknown step and an unknown harness', () => {
    expect(() => parseModelOverrides(['nope=claude:a'])).toThrow('unknown step "nope"')
    expect(() => parseModelOverrides(['select=nope:a'])).toThrow('unknown harness "nope"')
  })

  it('reads the other registered harnesses', () => {
    expect(parseModelOverrides(['select=grok:g', 'pillar.design=opencode:a/b'])).toEqual({
      select: [{ harness: 'grok', model: 'g' }],
      'pillar.design': [{ harness: 'opencode', model: 'a/b' }],
    })
  })

  it('rejects a free model for the verifier and a refused shell step', () => {
    expect(() => parseModelOverrides(['verifier=opencode:opencode/big-pickle'])).toThrow(
      '--model verifier: step "verifier" cannot use the free model',
    )
    expect(() => parseModelOverrides(['pillar.history=grok:g'])).toThrow(
      '--model pillar.history: step "pillar.history" has no candidate',
    )
    expect(parseModelOverrides(['pillar.history=grok:g', 'pillar.history=claude:haiku'])).toEqual({
      'pillar.history': [{ harness: 'grok', model: 'g' }, claude('haiku')],
    })
  })
})

describe('modelTable', () => {
  it('lists every default step and the ones a plan sets', () => {
    const table = modelTable(
      resolveModelPlan({ steps: { select: 'large', 'pillar.rules': 'small' } }),
    )
    expect(table.select).toEqual([claude('opus')])
    expect(table['pillar.rules']).toEqual([claude('haiku')])
    expect(table.pillars).toEqual([claude('sonnet')])
    expect(table['pillar.history']).toEqual([claude('haiku')])
    expect(Object.keys(table)).toEqual([
      'select',
      'pillars',
      'focus',
      'pillar.history',
      'verifier',
      'verifier.light',
      'evidence',
      'approvalCheck',
      'pillar.rules',
    ])
  })

  it('runs the focus step on the pillars tier until `focus` is set', () => {
    expect(stepKeys('focus')).toEqual(['focus', 'pillars'])
    const table = modelTable(resolveModelPlan({ steps: { pillars: 'large' } }))
    expect(table.focus).toEqual([claude('opus')])
    const own = modelTable(resolveModelPlan({ steps: { pillars: 'large', focus: 'small' } }))
    expect(own.focus).toEqual([claude('haiku')])
    expect(parseModelOverrides(['focus=claude:haiku'])).toEqual({ focus: [claude('haiku')] })
  })

  it('resolves a pillar with the keys the runner uses, so `pillars` reaches history', () => {
    const table = modelTable(resolveModelPlan({ steps: { pillars: 'large' } }))
    expect(table['pillar.history']).toEqual([claude('opus')])
    expect(table.pillars).toEqual([claude('opus')])
    expect(table.select).toEqual([claude('haiku')])
    const own = modelTable(
      resolveModelPlan({ steps: { pillars: 'large', 'pillar.history': 'medium' } }),
    )
    expect(own['pillar.history']).toEqual([claude('sonnet')])
  })

  it('shows a step with its own list as that list', () => {
    const table = modelTable(resolveModelPlan({ steps: { evidence: [claude('q')] } }))
    expect(table.evidence).toEqual([claude('q')])
  })
})

describe('runModelStep', () => {
  it('runs the resolved candidates with the plan wait budget and the injected clock', async () => {
    const models = {
      plan: resolveModelPlan({ retry: { maxWaitSeconds: 1 }, steps: { select: [claude('q')] } }),
      clock: { sleep: async () => {}, now: () => 0 },
    }
    const seen: string[] = []
    const exec = async (_command: string, args: string[]) => {
      seen.push(args[args.indexOf('--model') + 1] as string)
      return JSON.stringify({ type: 'result', structured_output: 1 })
    }
    const request = { prompt: 'P', label: 'S', maxTurns: 1, schema: {}, can: READ_ONLY }
    const run = await runModelStep(models, { keys: ['select'], fallback: 'small' }, request, exec)
    expect(seen).toEqual(['q'])
    expect(run.ran.model).toBe('q')
    const other = await runModelStep(
      DEFAULT_STEP_MODELS,
      { keys: ['select'], fallback: 'small' },
      request,
      exec,
    )
    expect(other.ran.model).toBe('haiku')
  })
})

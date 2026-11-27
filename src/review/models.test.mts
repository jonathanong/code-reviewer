import { describe, expect, it } from 'vitest'

import { READ_ONLY } from '../harness/types.mts'
import {
  DEFAULT_MODEL_PLAN,
  DEFAULT_STEP_MODELS,
  DEFAULT_TIERS,
  candidatesFor,
  modelTable,
  resolveModelPlan,
  runModelStep,
  stepKeys,
  tierOfPlanned,
} from './models.mts'
import { parseModelOverrides } from './model-overrides.mts'

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
      'replies',
      'pillar.rules',
    ])
  })

  it('runs the focus step on the pillars tier until `focus` is set', () => {
    expect(stepKeys('focus')).toEqual(['focus', 'pillars'])
    const table = modelTable(resolveModelPlan({ steps: { pillars: 'large' } }))
    expect(table.focus).toEqual([claude('opus')])
    const own = modelTable(resolveModelPlan({ steps: { pillars: 'large', focus: 'small' } }))
    expect(own.focus).toEqual([claude('haiku')])
    expect(() => parseModelOverrides(['pillar.focus=claude:haiku'])).toThrow('unknown step')
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

  it('hands the review reference hosts to the harness on every step, only when there are some', async () => {
    const seen: object[] = []
    const exec = async (_command: string, args: string[]) => {
      seen.push(args)
      return JSON.stringify({ type: 'result', structured_output: 1 })
    }
    const request = { prompt: 'P', label: 'S', maxTurns: 1, schema: {}, can: READ_ONLY }
    const step = { keys: ['select'], fallback: 'small' } as const
    const plan = resolveModelPlan({
      steps: { select: [{ harness: 'agy', model: 'm', readsOutsideCheckout: true }] },
    })
    await runModelStep({ plan, referenceDomains: ['docs.a.test'] }, step, request, exec)
    await runModelStep({ plan, referenceDomains: [] }, step, request, exec)
    const settings = seen.map(
      (args) => (args as string[])[(args as string[]).indexOf('--settings') + 1],
    )
    expect(settings).toStrictEqual([
      '{"permissions":{"allow":["read_url(docs.a.test)"]}}',
      '{"permissions":{"allow":["read_url(invalid)"]}}',
    ])
  })
})

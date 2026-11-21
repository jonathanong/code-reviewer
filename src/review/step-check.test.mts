import { describe, expect, it } from 'vitest'

import { stepProblems } from './step-check.mts'
import { modelConfigProblems } from './models-check.mts'

const claude = (model: string) => ({ harness: 'claude', model })
const grok = (model: string) => ({ harness: 'grok', model })
const opencode = (model: string) => ({ harness: 'opencode', model })

describe('stepProblems', () => {
  it.each(['verifier', 'verifier.light', 'approvalCheck'])(
    'bars a free model, fallbacks included, from %s',
    (step) => {
      const problems = stepProblems(step, [
        opencode('opencode/grok-code-free'),
        opencode('anthropic/claude-sonnet'),
        opencode('opencode/big-pickle'),
      ])
      expect(problems).toEqual([
        `step "${step}" cannot use the free model "opencode/grok-code-free"`,
        `step "${step}" cannot use the free model "opencode/big-pickle"`,
      ])
    },
  )

  it('lets a free model run steps that do not judge or approve, and a paid one run the verifier', () => {
    expect(stepProblems('select', [opencode('opencode/grok-code-free')])).toEqual([])
    expect(stepProblems('pillar.design', [opencode('opencode/grok-code-free')])).toEqual([])
    expect(stepProblems('verifier', [opencode('anthropic/claude-sonnet'), grok('grok-4')])).toEqual(
      [],
    )
  })

  it.each(['pillar.history', 'evidence'])(
    'rejects %s when every candidate refuses shell, and names why',
    (step) => {
      const [problem, ...rest] = stepProblems(step, [grok('grok-4'), opencode('a/b')])
      expect(rest).toEqual([])
      expect(problem).toContain(`step "${step}" has no candidate that can run it`)
      expect(problem).toContain('grok cannot confine: shell prefixes')
      expect(problem).toContain('opencode cannot confine: shell prefixes')
    },
  )

  it('accepts a shell step when any candidate can run it, in any position', () => {
    expect(stepProblems('pillar.history', [grok('grok-4'), claude('haiku')])).toEqual([])
    expect(stepProblems('evidence', [claude('sonnet'), grok('grok-4')])).toEqual([])
  })

  it('leaves steps without static shell needs to the run-time refusal', () => {
    expect(stepProblems('pillar.security', [grok('grok-4')])).toEqual([])
  })
})

describe('modelConfigProblems', () => {
  it('finds a free model a tier carries into the verifier', () => {
    const problems = modelConfigProblems({ tiers: { large: [opencode('opencode/big-pickle')] } })
    expect(problems).toEqual([
      'step "verifier" cannot use the free model "opencode/big-pickle"',
      'step "approvalCheck" cannot use the free model "opencode/big-pickle"',
    ])
  })

  it('finds a history step the default tier resolves to a refusing harness', () => {
    const problems = modelConfigProblems({ tiers: { small: [grok('grok-4')] } })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('step "pillar.history"')
  })

  it('finds a pillars list that reaches history without a history step of its own', () => {
    expect(modelConfigProblems({ steps: { pillars: [grok('grok-4')] } })).toHaveLength(1)
    expect(
      modelConfigProblems({ steps: { pillars: [grok('grok-4')], 'pillar.history': 'small' } }),
    ).toEqual([])
  })

  it('finds nothing in the defaults or a config of paid models', () => {
    expect(modelConfigProblems({})).toEqual([])
    expect(
      modelConfigProblems({
        tiers: { large: [opencode('anthropic/claude-opus'), claude('opus')] },
        steps: { select: [opencode('opencode/grok-code-free')] },
      }),
    ).toEqual([])
  })
})

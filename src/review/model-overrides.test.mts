import { describe, expect, it } from 'vitest'

import { parseModelOverrides } from './model-overrides.mts'

const claude = (model: string) => ({ harness: 'claude', model })

describe('parseModelOverrides', () => {
  it('reads step=harness:model, keeping a model name that holds colons', () => {
    expect(parseModelOverrides(['verifier=claude:opus', 'pillar.design=claude:a:b'])).toEqual({
      verifier: [claude('opus')],
      'pillar.design': [claude('a:b')],
    })
  })

  it('marks a candidate readsOutsideCheckout only by a +outside suffix on the model', () => {
    expect(parseModelOverrides(['select=agy:gemini-4-hydrogen+outside', 'select=agy:b'])).toEqual({
      select: [
        { harness: 'agy', model: 'gemini-4-hydrogen', readsOutsideCheckout: true },
        { harness: 'agy', model: 'b' },
      ],
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

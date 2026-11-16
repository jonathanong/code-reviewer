import { describe, expect, it } from 'vitest'

import { addUsage } from './usage.mts'

describe('addUsage', () => {
  const model = {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    costUsd: 0.1,
  }
  const one = {
    costUsd: 0.2,
    turns: 1,
    durationMs: 10,
    inputTokens: 5,
    outputTokens: 1,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    byModel: { haiku: model },
  }

  it('returns the other side when one is missing', () => {
    expect(addUsage(null, one)).toBe(one)
    expect(addUsage(one, null)).toBe(one)
    expect(addUsage(null, null)).toBeNull()
  })

  it('sums fields and per-model usage, keeping null only when both are null', () => {
    const two = {
      ...one,
      costUsd: 0.01,
      cacheReadTokens: 7,
      durationMs: null,
      byModel: { haiku: model, opus: model },
    }
    const total = addUsage(one, two)
    expect(total).toMatchObject({
      turns: 2,
      inputTokens: 10,
      cacheReadTokens: 7,
      cacheCreationTokens: null,
    })
    expect(total?.costUsd).toBeCloseTo(0.21)
    expect(total?.durationMs).toBe(10)
    expect(total?.byModel.haiku).toMatchObject({ inputTokens: 2, cacheReadTokens: null })
    expect(total?.byModel.haiku?.costUsd).toBeCloseTo(0.2)
    expect(total?.byModel.opus).toBe(model)
  })
})

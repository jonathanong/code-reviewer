import { describe, expect, it } from 'vitest'

import type { Usage } from './usage.mts'
import {
  renderCostTable,
  renderModelTable,
  summarizeModels,
  summarizeUsage,
} from './usage-summary.mts'

const EMPTY: Usage = {
  costUsd: null,
  turns: null,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  byModel: {},
}

const usage = (fields: Partial<Usage>): Usage => ({ ...EMPTY, ...fields })

describe('model totals', () => {
  const full = {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 300,
    cacheCreationTokens: 40,
    costUsd: 0.5,
  }
  const runs = [
    usage({ byModel: { opus: full, haiku: { ...full, costUsd: null, outputTokens: null } } }),
    usage({ byModel: { opus: full } }),
    EMPTY,
    // A result saved before models were recorded has no byModel at all.
    { ...EMPTY, byModel: undefined } as unknown as Usage,
  ]

  it('sums input with cache tokens, counts runs per model, and sorts by id', () => {
    expect(summarizeModels(runs)).toEqual([
      { model: 'haiku', runs: 1, inputTokens: 350, outputTokens: 0, costUsd: 0 },
      { model: 'opus', runs: 2, inputTokens: 700, outputTokens: 40, costUsd: 1 },
    ])
    expect(summarizeUsage(runs).models).toHaveLength(2)
  })

  it('renders per-group rows and an all row per model', () => {
    const table = renderModelTable([
      { name: 'rules', models: summarizeModels([runs[0] as Usage]) },
      { name: 'design', models: summarizeModels([runs[1] as Usage]) },
    ])
    expect(table.split('\n')).toEqual([
      '| Pillar | Model | Runs | Input tokens | Output tokens | Cost |',
      '| --- | --- | --- | --- | --- | --- |',
      '| rules | haiku | 1 | 350 | 0 | $0.00 |',
      '| rules | opus | 1 | 350 | 20 | $0.50 |',
      '| design | opus | 1 | 350 | 20 | $0.50 |',
      '| all | haiku | 1 | 350 | 0 | $0.00 |',
      '| all | opus | 2 | 700 | 40 | $1.00 |',
    ])
    expect(renderModelTable([], 'Run').startsWith('| Run |')).toBe(true)
  })
})

describe('summarizeUsage', () => {
  it('totals cost and averages turns and total input tokens over runs that have them', () => {
    const summary = summarizeUsage([
      usage({ costUsd: 1, turns: 10, inputTokens: 5, cacheReadTokens: 90, cacheCreationTokens: 5 }),
      usage({ costUsd: 2, turns: 20, cacheReadTokens: 300 }),
      EMPTY,
    ])
    expect(summary).toEqual({
      runs: 3,
      totalCostUsd: 3,
      meanCostUsd: 1.5,
      meanTurns: 15,
      meanInputTokens: 200,
      models: [],
    })
  })

  it('is all null with no usage rather than zero', () => {
    expect(summarizeUsage([])).toEqual({
      runs: 0,
      totalCostUsd: null,
      meanCostUsd: null,
      meanTurns: null,
      meanInputTokens: null,
      models: [],
    })
  })
})

describe('renderCostTable', () => {
  it('renders dollars, one-decimal turns, whole tokens, and n/a', () => {
    const table = renderCostTable([
      {
        pillar: 'design',
        usage: summarizeUsage([usage({ costUsd: 1.25, turns: 3, inputTokens: 1234 })]),
      },
      { pillar: 'rules', usage: summarizeUsage([]) },
    ])
    expect(table.split('\n').slice(2)).toEqual([
      '| design | 1 | $1.25 | $1.25 | 3.0 | 1234 |',
      '| rules | 0 | n/a | n/a | n/a | n/a |',
    ])
  })
})

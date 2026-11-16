import { describe, expect, it } from 'vitest'

import { ExecError } from './exec.mts'
import { describeFailure, parseUsage, type Usage } from './usage.mts'
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

describe('parseUsage', () => {
  it('returns nulls without an event, with non-numeric fields, or with a non-object usage', () => {
    expect(parseUsage(undefined)).toEqual(EMPTY)
    expect(parseUsage({ total_cost_usd: '3', num_turns: Number.NaN, usage: 'x' })).toEqual(EMPTY)
  })
})

describe('parseUsage modelUsage', () => {
  const model = {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadInputTokens: 300,
    cacheCreationInputTokens: 40,
    costUSD: 0.5,
  }

  it('reads each model with renamed token fields', () => {
    expect(parseUsage({ modelUsage: { 'claude-opus': model } }).byModel).toEqual({
      'claude-opus': {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 300,
        cacheCreationTokens: 40,
        costUsd: 0.5,
      },
    })
  })

  it('gives {} for missing or malformed model usage and drops malformed entries', () => {
    expect(parseUsage({}).byModel).toEqual({})
    expect(parseUsage({ modelUsage: 'x' }).byModel).toEqual({})
    expect(parseUsage({ modelUsage: [model] }).byModel).toEqual({})
    const parsed = parseUsage({ modelUsage: { bad: 3, partial: { costUSD: 'free' } } }).byModel
    expect(Object.keys(parsed)).toEqual(['partial'])
    expect(parsed.partial).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costUsd: null,
    })
  })
})

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

describe('describeFailure', () => {
  const stdout = [
    JSON.stringify({ type: 'assistant' }),
    JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      num_turns: 40,
      total_cost_usd: 3,
    }),
  ].join('\n')

  it('adds the result subtype to the exit line and keeps the usage', () => {
    const error = new ExecError('claude exited with 1\ntail', 1, stdout, null)
    expect(describeFailure(error)).toEqual({
      message: 'claude exited with 1 (error_max_turns)\ntail',
      usage: usage({ turns: 40, costUsd: 3 }),
    })
  })

  it('keeps the message when the result event has no subtype', () => {
    const bare = JSON.stringify({ type: 'result', total_cost_usd: 1 })
    const failure = describeFailure(new ExecError('claude exited with 1', 1, bare, null))
    expect(failure).toEqual({ message: 'claude exited with 1', usage: usage({ costUsd: 1 }) })
  })

  it('records no usage when stdout has no result event', () => {
    expect(describeFailure(new ExecError('claude exited with 2', 2, 'crash', null))).toEqual({
      message: 'claude exited with 2',
      usage: null,
    })
  })

  it('passes other errors through', () => {
    expect(describeFailure(new Error('boom'))).toEqual({ message: 'boom', usage: null })
    expect(describeFailure('plain')).toEqual({ message: 'plain', usage: null })
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

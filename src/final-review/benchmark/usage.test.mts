import { describe, expect, it } from 'vitest'

import { ExecError } from './exec.mts'
import { describeFailure, parseUsage, type Usage } from './usage.mts'
import { renderCostTable, summarizeUsage } from './usage-summary.mts'

const EMPTY: Usage = {
  costUsd: null,
  turns: null,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
}

const usage = (fields: Partial<Usage>): Usage => ({ ...EMPTY, ...fields })

describe('parseUsage', () => {
  it('returns nulls without an event, with non-numeric fields, or with a non-object usage', () => {
    expect(parseUsage(undefined)).toEqual(EMPTY)
    expect(parseUsage({ total_cost_usd: '3', num_turns: Number.NaN, usage: 'x' })).toEqual(EMPTY)
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
    })
  })

  it('is all null with no usage rather than zero', () => {
    expect(summarizeUsage([])).toEqual({
      runs: 0,
      totalCostUsd: null,
      meanCostUsd: null,
      meanTurns: null,
      meanInputTokens: null,
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

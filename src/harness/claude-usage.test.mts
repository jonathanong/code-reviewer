import { describe, expect, it } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import type { Usage } from '../review/benchmark/usage.mts'
import { describeFailure, parseUsage } from './claude-usage.mts'

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

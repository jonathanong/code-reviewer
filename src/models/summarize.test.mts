import { describe, expect, it } from 'vitest'

import { renderTable } from './render.mts'
import { rank, summarize } from './summarize.mts'
import type { ModelStats, RunRecord } from './types.mts'

const run = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  valid: true,
  found: true,
  extra: 0,
  seconds: 2,
  tokens: 100,
  costUsd: 0.25,
  rateLimited: false,
  ...overrides,
})

describe('summarize', () => {
  it('averages the scored runs and sums the cost', () => {
    const stats = summarize('p/m', [
      run(),
      run({ found: false, extra: 2, seconds: 4, tokens: 300, costUsd: 0.75 }),
      run({ valid: false, found: false, seconds: 6, tokens: null, costUsd: null, failure: 'bad' }),
    ])
    expect(stats).toEqual({
      id: 'p/m',
      runs: 3,
      valid: 2 / 3,
      found: 1 / 3,
      extra: 1,
      seconds: 4,
      tokens: 200,
      costUsd: 1,
      rateLimited: 0,
      failures: ['bad'],
    })
  })

  it('reports a rate-limited run apart from the model and keeps its failure', () => {
    const stats = summarize('p/m', [
      run(),
      run({ valid: false, found: false, rateLimited: true, failure: 'slow down', seconds: 99 }),
      run({ valid: false, found: false, rateLimited: true, failure: 'slow down' }),
    ])
    expect(stats).toMatchObject({
      runs: 3,
      valid: 1,
      found: 1,
      seconds: 2,
      rateLimited: 2,
      failures: ['slow down'],
    })
  })

  it('leaves measures null when nothing could be scored', () => {
    const stats = summarize('p/m', [
      run({ valid: false, found: false, rateLimited: true, tokens: null, costUsd: null }),
    ])
    expect(stats).toMatchObject({
      valid: null,
      found: null,
      extra: null,
      seconds: null,
      tokens: null,
      costUsd: null,
      rateLimited: 1,
    })
  })
})

const stats = (id: string, found: number | null, valid: number | null, seconds: number | null) =>
  ({ ...summarize(id, []), found, valid, seconds }) satisfies ModelStats

describe('rank', () => {
  it('sorts by found desc, valid desc, seconds asc, unscored last, then id', () => {
    const ranked = rank([
      stats('unscored', null, null, null),
      stats('slow', 1, 1, 9),
      stats('b-tie', 1, 1, 5),
      stats('a-tie', 1, 1, 5),
      stats('less-valid', 1, 0.5, 1),
      stats('misses', 0.5, 1, 1),
      stats('valid-unscored', 1, null, 1),
      stats('seconds-unscored', 1, 1, null),
    ])
    expect(ranked.map((model) => model.id)).toEqual([
      'a-tie',
      'b-tie',
      'slow',
      'seconds-unscored',
      'less-valid',
      'valid-unscored',
      'misses',
      'unscored',
    ])
  })

  it('does not change its input', () => {
    const input = [stats('b', 0, 1, 1), stats('a', 1, 1, 1)]
    rank(input)
    expect(input.map((model) => model.id)).toEqual(['b', 'a'])
  })
})

describe('renderTable', () => {
  it('writes one row per model with dashes for unscored measures and escaped failures', () => {
    const table = renderTable({
      harness: 'opencode',
      models: [
        summarize('p/m', [run(), run({ valid: false, found: false, failure: 'a|b' })]),
        stats('p/none', null, null, null),
      ],
    })
    const lines = table.split('\n')
    expect(lines[0]).toBe('Harness: opencode')
    expect(lines[4]).toBe('| p/m | 2 | 0.50 | 0.50 | 0.0 | 2.0 | 100 | 0.5000 | 0 | a\\|b |')
    expect(lines[5]).toBe('| p/none | 0 | - | - | - | - | - | - | 0 |  |')
  })
})

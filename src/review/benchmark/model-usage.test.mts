import { describe, expect, it } from 'vitest'

import { renderModelReports, summarizeByModel } from './model-usage.mts'
import type { Usage } from './usage.mts'

const entry = (n: number | null) => ({
  inputTokens: n,
  outputTokens: n === null ? null : n * 2,
  cacheReadTokens: n === null ? null : n * 10,
  cacheCreationTokens: null,
  costUsd: n,
})
const run = (byModel: Usage['byModel']): Usage => ({
  costUsd: null,
  turns: null,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  byModel,
})

describe('summarizeByModel', () => {
  const usages = [
    run({ opus: entry(100), haiku: entry(10) }),
    run({ opus: entry(300) }),
    null,
    // A record saved before models were kept has no byModel.
    { ...run({}), byModel: undefined } as unknown as Usage,
    run({}),
  ]
  const report = summarizeByModel('design', 'control', usages)

  it('counts missing runs apart from runs that used the model, and never as zero', () => {
    expect(report).toMatchObject({ group: 'design', arm: 'control', runs: 5, covered: 2 })
    expect(report.models.map((m) => [m.model, m.runs])).toEqual([
      ['haiku', 1],
      ['opus', 2],
    ])
    expect(report.models[1]).toMatchObject({
      inputTokens: { total: 400, mean: 200, runs: 2 },
      cacheReadTokens: { total: 4000, mean: 2000, runs: 2 },
      cacheCreationTokens: null,
      outputTokens: { total: 800, mean: 400, runs: 2 },
      costUsd: { total: 400, mean: 200, runs: 2 },
    })
  })

  it('averages a figure over only the runs that reported it', () => {
    const partial = summarizeByModel('g', null, [run({ m: entry(null) }), run({ m: entry(4) })])
    expect(partial.models[0]?.costUsd).toEqual({ total: 4, mean: 4, runs: 1 })
    expect(partial.models[0]?.inputTokens).toEqual({ total: 4, mean: 4, runs: 1 })
  })

  it('renders total / per run, dollars, n/a, and a row for a group with no models', () => {
    const table = renderModelReports([report, summarizeByModel('rules', null, [null, null])])
    expect(table.split('\n').slice(2)).toEqual([
      '| design | control | haiku | 1 of 2 of 5 | 10 / 10 | 100 / 100 | n/a | 20 / 20 | $10.00 / $10.00 |',
      '| design | control | opus | 2 of 2 of 5 | 400 / 200 | 4,000 / 2,000 | n/a | 800 / 400 | $400.00 / $200.00 |',
      '| rules | - | n/a | 0 of 0 of 2 | n/a | n/a | n/a | n/a | n/a |',
    ])
  })
})

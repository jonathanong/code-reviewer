import { describe, expect, it } from 'vitest'

import type { ReportData } from '../run/report.mts'
import { renderReplies, withReplies, type RepliesRecord } from './report.mts'

const record: RepliesRecord = {
  at: '2026-11-27T00:00:00.000Z',
  settled: 1,
  downgraded: 1,
  open: 2,
  verdictBefore: 'Request Changes',
  verdictAfter: 'Approve',
  posted: true,
  costUsd: 0.0123,
}

const usage = {
  costUsd: 0.0123,
  turns: 1,
  durationMs: 10,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  byModel: {
    sonnet: {
      costUsd: 0.0123,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
  },
}

describe('replies in the report', () => {
  it('renders nothing without a re-assessment, and one line for each', () => {
    expect(renderReplies(undefined)).toEqual([])
    expect(renderReplies([])).toEqual([])
    const [heading, body] = renderReplies([record, { ...record, posted: false, costUsd: null }])
    expect(heading).toBe('### Replies re-assessed')
    expect(body).toContain(
      '1 settled, 1 lowered, 2 still open; verdict Request Changes to Approve (posted); $0.0123',
    )
    expect(body).toContain('n/a')
    const [, checked] = renderReplies([{ ...record, approval: 'not upheld' }])
    expect(checked).toContain('(posted); approval check not upheld; $0.0123')
  })

  it('adds the record, the replies step to the cost table, and the model that ran', () => {
    const data = {
      usageByModel: [{ name: 'verifier', models: [] }],
      ran: [],
    } as unknown as ReportData
    const next = withReplies(data, record, usage, {
      model: 'sonnet',
      harness: 'claude',
      waitedMs: 0,
    } as never)
    expect(next.replies).toEqual([record])
    expect(next.usageByModel.map((step) => step.name)).toEqual(['verifier', 'replies'])
    expect(next.usageByModel[1]?.models.length).toBeGreaterThan(0)
    expect(next.ran?.at(-1)).toMatchObject({ step: 'replies', model: 'sonnet' })
    const again = withReplies(next, record, null, undefined)
    expect(again.replies).toHaveLength(2)
    expect(again.usageByModel.at(-1)?.models).toEqual([])
    expect(again.ran).toHaveLength(1)
  })

  it('starts the lists when the report had none', () => {
    const bare = { usageByModel: [] } as unknown as ReportData
    expect(withReplies(bare, record, null, undefined).ran).toEqual([])
  })
})

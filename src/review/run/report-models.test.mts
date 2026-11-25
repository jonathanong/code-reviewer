import { describe, expect, it } from 'vitest'

import { ranRows, renderRan } from './report-models.mts'

const ran = (model: string, waitedMs = 0) => ({ harness: 'claude', model, waitedMs })

describe('ranRows', () => {
  it('lists the steps that recorded a model in review order and skips the rest', () => {
    const rows = ranRows({
      skillSelection: { selected: [], available: 0, usage: null, ran: ran('a') },
      pillars: [
        { pillar: 'rules', model: 'b', ran: ran('b', 1500) },
        { pillar: 'design', model: 'c' },
      ] as never,
      verifier: { ran: ran('d') },
      evidence: { ran: ran('e') } as never,
      approvalCheck: { ran: ran('f') } as never,
    })
    expect(rows.map((row) => [row.step, row.model, row.waitedMs])).toEqual([
      ['selection', 'a', 0],
      ['rules', 'b', 1500],
      ['verifier', 'd', 0],
      ['evidence', 'e', 0],
      ['approval check', 'f', 0],
    ])
  })

  it('has no row for a run that predates the record', () => {
    const rows = ranRows({
      skillSelection: { selected: [], available: 0, usage: null },
      pillars: [],
      verifier: undefined,
    })
    expect(rows).toEqual([])
  })
})

describe('renderRan', () => {
  it('renders nothing for no rows', () => {
    expect(renderRan([])).toEqual([])
  })

  it('renders a table with the wait in whole seconds', () => {
    const [heading, table] = renderRan([{ step: 'rules', ...ran('opus', 61_400) }]) as string[]
    expect(heading).toBe('### Models')
    expect(table).toBe(
      [
        '| Step | Harness | Model | Waited on rate limits |',
        '| --- | --- | --- | --- |',
        '| rules | claude | opus | 61s |',
      ].join('\n'),
    )
  })

  it('notes each candidate a step moved past and why', () => {
    const skipped = [
      {
        harness: 'agy',
        model: 'gemini-4-neon',
        why: 'refused (agy cannot confine: web hosts (Verifier))',
      },
    ]
    const [, table, notes] = renderRan([
      { step: 'verifier', ...ran('sonnet'), skipped },
    ]) as string[]
    expect(table).toContain('| verifier | claude | sonnet | 0s |')
    expect(notes).toBe(
      '- verifier: skipped agy gemini-4-neon: refused (agy cannot confine: web hosts (Verifier))',
    )
  })
})

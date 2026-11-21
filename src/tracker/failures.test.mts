import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { memoryTracker } from '../outcomes/github-fake-io.mts'
import { FAILURES_FILE, readFailedSteps, readFailures, recordFailures } from './failures.mts'
import { recordReview } from './record.mts'

const FIXTURE = resolve(import.meta.dirname, 'fixtures', 'harness-failed')
const HEAD = '2'.repeat(40)
const review = {
  repo: 'acme/widgets',
  pr: 4,
  out: FIXTURE,
  startedAt: '2026-02-03T03:00:00.000Z',
  ok: true,
  summary: { claimed: true, mode: 'full', review: 'review.json' },
}

describe('recordFailures', () => {
  it('records the steps that carry a harness failure kind, and no others', () => {
    const io = memoryTracker()
    recordFailures(io, 'r#1@h', [
      { step: 'selection', harness: 'claude' },
      { step: 'security', harness: 'claude', failure: 'timeout' },
      { step: 'design', harness: 'claude', failure: 'made-up' },
      { step: 'verifier', failure: 'crash' },
      'not a record',
    ])
    expect(readFailures(io)).toEqual([
      {
        at: io.now().toISOString(),
        harness: 'claude',
        step: 'security',
        kind: 'timeout',
        run: 'r#1@h',
      },
    ])
  })

  it('writes nothing for a report with no ran list', () => {
    const io = memoryTracker()
    recordFailures(io, 'r#1@h', undefined)
    expect(io.read(`${io.dir}/${FAILURES_FILE}`)).toBeUndefined()
  })

  it('does not count a review twice when it is recorded again', () => {
    const io = memoryTracker()
    const ran = [{ step: 'security', harness: 'claude', failure: 'crash' }]
    recordFailures(io, 'r#1@h', ran)
    recordFailures(io, 'r#1@h', ran)
    recordFailures(io, 'r#1@other', ran)
    expect(readFailures(io).map((row) => row.run)).toEqual(['r#1@h', 'r#1@other'])
  })

  it('skips lines that are not failure rows', () => {
    const io = memoryTracker()
    const good = {
      at: '2026-02-03T00:00:00.000Z',
      harness: 'g',
      step: 's',
      kind: 'crash',
      run: 'x',
    }
    const lines = [
      'not json',
      '{"kind":"crash"}',
      JSON.stringify({ ...good, at: 'never' }),
      JSON.stringify(good),
    ]
    io.append(`${io.dir}/${FAILURES_FILE}`, `${lines.join('\n')}\n`)
    expect(readFailures(io)).toEqual([good])
  })
})

describe('readFailedSteps', () => {
  it.each([
    ['a missing file', undefined],
    ['text that is not JSON', 'not json'],
    ['JSON that is not a list', '{"step":"verifier"}'],
  ])('reads no steps from %s', (_name, text) => {
    expect(readFailedSteps(() => text, '/run')).toEqual([])
  })

  it('reads the saved list', () => {
    expect(readFailedSteps(() => '[{"step":"verifier"}]', '/run')).toEqual([{ step: 'verifier' }])
  })
})

describe('recordReview', () => {
  it('records the harness failures in the report, keyed by the review', () => {
    const io = memoryTracker()
    expect(recordReview(io, review)).toEqual({})
    const run = `acme/widgets#4@${HEAD}`
    expect(
      readFailures(io).map(({ harness, step, kind, run }) => ({ harness, step, kind, run })),
    ).toEqual([
      { harness: 'claude', step: 'security', kind: 'timeout', run },
      { harness: 'grok', step: 'my-private-pillar', kind: 'crash', run },
    ])
  })

  it('records a verifier that failed before any report, once however often it is recorded', () => {
    const io = memoryTracker()
    const stopped = {
      ...review,
      ok: false,
      out: resolve(import.meta.dirname, 'fixtures', 'harness-failed-stopped'),
      summary: { claimed: true, error: 'claude exited with null' },
    }
    recordReview(io, stopped)
    recordReview(io, stopped)
    expect(
      readFailures(io).map(({ harness, step, kind, run }) => ({ harness, step, kind, run })),
    ).toEqual([
      {
        harness: 'claude',
        step: 'verifier',
        kind: 'timeout',
        run: `acme/widgets#4@${'3'.repeat(40)}`,
      },
    ])
  })

  it('counts a review recorded twice once', () => {
    const io = memoryTracker()
    recordReview(io, review)
    recordReview(io, review)
    expect(readFailures(io)).toHaveLength(2)
  })
})

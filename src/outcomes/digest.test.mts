import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { proposals, renderDigest, writeDigest } from './digest.mts'
import { memoryTracker } from './github-fake-io.mts'
import { readOutcomes, saveOutcomes } from './store.mts'
import { OUTCOMES_FILE } from './store.mts'
import { noReactions } from './reactions.mts'
import type { Outcome, OutcomeRow } from './types.mts'

let counter = 0
function row(outcome: Outcome, over: Partial<OutcomeRow> = {}): OutcomeRow {
  counter += 1
  return {
    repo: 'acme/widgets',
    pr: 7,
    reviewId: 100,
    head: 'b'.repeat(40),
    key: `k${counter}`,
    pillar: 'rules',
    severity: 'high',
    rule: null,
    title: `Finding ${counter}`,
    path: 'src/a.ts',
    url: `https://example.test/c/${counter}`,
    outcome,
    reactions: { finding: noReactions(), review: noReactions() },
    checkedAt: '2026-06-10T12:00:00.000Z',
    ...over,
  }
}

const many = (count: number, outcome: Outcome, over: Partial<OutcomeRow> = {}) =>
  Array.from({ length: count }, () => row(outcome, over))

describe('proposals', () => {
  it('lists a pillar with at least 3 findings and at least half rejected or disputed', () => {
    const rows = [...many(1, 'rejected'), ...many(1, 'disputed'), ...many(1, 'fixed')]
    expect(proposals(rows)).toEqual([
      '- Review this pillar/prompt: `rules` (2 of 3 rejected or disputed)',
    ])
  })

  it('lists a rule the same way', () => {
    const rows = many(3, 'rejected', { rule: 'p:skill', pillar: null })
    expect(proposals(rows)).toEqual([
      '- Review this rule/prompt: `p:skill` (3 of 3 rejected or disputed)',
    ])
  })

  it('does not judge a group below the minimum or below half', () => {
    expect(proposals(many(2, 'rejected'))).toEqual([])
    expect(proposals([...many(1, 'rejected'), ...many(3, 'fixed')])).toEqual([])
  })

  it('never counts ignored findings as wrong', () => {
    expect(proposals(many(5, 'ignored'))).toEqual([])
  })

  it('lists a rule with 3 fixed and none rejected as working, but not with a rejection or fewer', () => {
    const working = many(3, 'fixed', { rule: 'p:good' })
    expect(proposals(working)).toEqual(['- Working: `p:good` (3 fixed, none rejected)'])
    expect(proposals([...working, ...many(1, 'rejected', { rule: 'p:good' })])).toEqual([])
    expect(proposals(many(2, 'fixed', { rule: 'p:good' }))).toEqual([])
  })

  it('does not call a pillar working, only rules', () => {
    expect(proposals(many(4, 'fixed'))).toEqual([])
  })
})

describe('renderDigest', () => {
  const rows = [
    ...many(2, 'fixed', { rule: 'p:good', severity: 'low' }),
    row('rejected', { title: 'Odd [name] <b>', path: null, url: null, pillar: 'design' }),
    row('disputed', { title: 'Plain' }),
    row('ignored', { pillar: null, severity: null }),
  ]
  const text = renderDigest(rows, '2026-06-10')

  it('totals by outcome, pillar, severity and rule skill', () => {
    expect(text).toContain('# Review outcomes 2026-06-10')
    expect(text).toContain('5 findings recorded')
    expect(text).toContain(
      '| outcome | total | fixed | disputed | dismissed | open | ignored | resolved | rejected |',
    )
    expect(text).toContain('| fixed | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |')
    expect(text).toContain('| rules | 3 |')
    expect(text).toContain('| design | 1 |')
    expect(text).toContain('| low | 2 |')
    expect(text).toContain('| p:good | 2 |')
  })

  it('lists rejected and disputed findings with links, titles and paths only', () => {
    expect(text).toContain('- disputed: [Plain](https://example.test/c/')
    expect(text).toContain('(`src/a.ts`)')
    expect(text).toContain(
      '[Odd \\[name\\] \\<b\\>](https://github.com/acme/widgets/pull/7) in acme/widgets#7',
    )
  })

  it('lists the proposals it finds', () => {
    expect(renderDigest(many(3, 'rejected'), '2026-06-10')).toContain(
      '- Review this pillar/prompt: `rules`',
    )
  })

  it('says None for empty sections', () => {
    const empty = renderDigest([], '2026-06-10')
    expect(empty.match(/None\./gu)).toHaveLength(6)
  })
})

describe('writeDigest', () => {
  it('writes outcomes-DAY.md beside the rows by default, and into --out when given', () => {
    const tracker = memoryTracker()
    saveOutcomes(tracker, [row('fixed')])
    const beside = writeDigest(tracker, '2026-06-10', undefined)
    expect(beside).toBe(join(tracker.dir, 'outcomes-2026-06-10.md'))
    expect(readFileSync(beside, 'utf8')).toContain('1 findings recorded')
    const out = join(tracker.dir, 'reports')
    expect(writeDigest(tracker, '2026-06-11', out)).toBe(join(out, 'outcomes-2026-06-11.md'))
  })

  it('rejects a day that is not YYYY-MM-DD', () => {
    expect(() => writeDigest(memoryTracker(), '06/10', undefined)).toThrow(
      '--day must be YYYY-MM-DD.',
    )
  })
})

describe('the rows file', () => {
  it('updates rows by finding key and never duplicates, keeping rows it did not touch', () => {
    const tracker = memoryTracker()
    const first = row('open', { key: 'same' })
    const other = row('open', { key: 'other' })
    saveOutcomes(tracker, [first, other])
    const stored = saveOutcomes(tracker, [{ ...first, outcome: 'fixed' }])
    expect(stored.map((found) => [found.key, found.outcome])).toEqual([
      ['same', 'fixed'],
      ['other', 'open'],
    ])
    expect(readFileSync(join(tracker.dir, OUTCOMES_FILE), 'utf8').split('\n')).toHaveLength(3)
  })

  it('skips lines that are not rows and reads nothing before the first write', () => {
    const tracker = memoryTracker()
    expect(readOutcomes(tracker)).toEqual([])
    tracker.append(
      join(tracker.dir, OUTCOMES_FILE),
      `oops\n[1]\n{"key":"x","repo":"a/b","outcome":"nope"}\n${JSON.stringify(row('open'))}\n`,
    )
    expect(readOutcomes(tracker)).toHaveLength(1)
  })
})

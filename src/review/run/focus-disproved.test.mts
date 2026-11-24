import { describe, expect, it } from 'vitest'

import type { Finding } from '../finding.mts'
import { FOCUS_PILLAR, type FocusAnswer } from '../focus.mts'
import { disprovedLinks, withDisproved } from './disproved.mts'
import { keptFocus } from './focus-kept.mts'

const finding = (
  pillar: Finding['pillar'],
  path?: string,
  line?: number,
  title = 'T',
): Finding => ({
  pillar,
  severity: 'high',
  title,
  body: 'B',
  ...(path === undefined ? {} : { path }),
  ...(line === undefined ? {} : { line }),
})
const holds: FocusAnswer = {
  point: 'REQUESTER TEXT',
  origin: 'requester',
  status: 'holds',
  basis: 'OLD BASIS',
  path: 'old.ts',
  line: 1,
}
const unchecked: FocusAnswer = { point: 'second', status: 'not_checked', basis: 'Unclear.' }
const inputs = [finding('correctness', 'a.ts', 7), finding('rules', 'b.ts', 2)]
const kept = [finding('correctness', 'a.ts', 7)]
const link = (check: number, finding: number, reason = 'One worker drops the check.') => ({
  check,
  finding,
  reason,
})
const apply = (
  answers: FocusAnswer[],
  disproved: ReturnType<typeof link>[],
  options: { kept?: Finding[]; dropped?: Map<number, string> } = {},
) => keptFocus(answers, options.kept ?? kept, inputs, options.dropped ?? new Map(), disproved)

describe('keptFocus with disproved links', () => {
  it('turns holds and not_checked into does_not_hold with the reason and the kept finding location', () => {
    const result = apply([holds, unchecked], [link(0, 0), link(1, 0, 'Same finding.')])
    expect(result?.[0]).toEqual({
      point: 'REQUESTER TEXT',
      origin: 'requester',
      status: 'does_not_hold',
      basis: 'One worker drops the check.',
      path: 'a.ts',
      line: 7,
    })
    expect(result?.[1]).toEqual({
      point: 'second',
      status: 'does_not_hold',
      basis: 'Same finding.',
      path: 'a.ts',
      line: 7,
    })
  })

  it('never copies requester text or the old basis into the new basis', () => {
    const flipped = apply([holds], [link(0, 0)])?.[0]
    expect(flipped?.status).toBe('does_not_hold')
    expect(flipped?.basis).not.toContain('REQUESTER TEXT')
    expect(flipped?.basis).not.toContain('OLD BASIS')
  })

  it('flips an answer the drop logic just made not_checked', () => {
    const fails: FocusAnswer = {
      point: 'p',
      status: 'does_not_hold',
      basis: 'It does not.',
      path: 'gone.ts',
      line: 3,
    }
    expect(apply([fails], [link(0, 0)])?.[0]).toMatchObject({
      status: 'does_not_hold',
      basis: 'One worker drops the check.',
      path: 'a.ts',
    })
    expect(apply([fails], [])?.[0]?.status).toBe('not_checked')
  })

  it('leaves an answer that already stands as does_not_hold unchanged', () => {
    const standing: FocusAnswer = {
      point: 'p',
      status: 'does_not_hold',
      basis: 'Stands.',
      path: 'a.ts',
      line: 7,
    }
    expect(apply([standing], [link(0, 0)])?.[0]).toBe(standing)
  })

  it('ignores a link whose check or finding is out of range, without failing', () => {
    expect(apply([holds], [link(5, 0), link(0, 9)])?.[0]).toBe(holds)
  })

  it('ignores a link to a finding the verifier dropped or did not keep', () => {
    expect(apply([holds], [link(0, 0)], { dropped: new Map([[0, 'No.']]) })?.[0]).toBe(holds)
    expect(apply([holds], [link(0, 1)])?.[0]).toBe(holds)
    expect(apply([holds], [link(0, 0)], { kept: [] })?.[0]).toBe(holds)
  })

  it('lets the first valid link for a check win and skips an invalid one before it', () => {
    const links = [link(0, 1, 'Not kept.'), link(0, 0, 'First.'), link(0, 0, 'Second.')]
    expect(apply([holds], links)?.[0]?.basis).toBe('First.')
  })

  it("counts another pillar's kept copy on the same path and line as the finding kept", () => {
    const copy = [finding(FOCUS_PILLAR, 'a.ts', 7)]
    expect(apply([holds], [link(0, 0)], { kept: copy })?.[0]?.status).toBe('does_not_hold')
    const moved = [finding('correctness', 'a.ts', 8)]
    expect(apply([holds], [link(0, 0)], { kept: moved })?.[0]).toBe(holds)
  })

  it('omits path and line when the kept finding has none, matching it by pillar and title', () => {
    const pathless = [finding('design', undefined, undefined, 'Whole project')]
    const run = (copy: Finding[]) =>
      keptFocus([holds], copy, pathless, new Map(), [link(0, 0)])?.[0] as FocusAnswer
    expect(run([finding('design', undefined, undefined, 'Whole project')])).toEqual({
      point: 'REQUESTER TEXT',
      origin: 'requester',
      status: 'does_not_hold',
      basis: 'One worker drops the check.',
    })
    expect(run([finding('design', undefined, undefined, 'Other')])).toBe(holds)
    expect(run([finding('rules', undefined, undefined, 'Whole project')])).toBe(holds)
    expect(run([finding('design', 'a.ts', 1, 'Whole project')])).toBe(holds)
  })
})

describe('disprovedLinks and withDisproved', () => {
  it('keeps well-formed links in order and ignores the rest', () => {
    expect(disprovedLinks(undefined)).toEqual([])
    const raw = [link(1, 2, ' Why. '), { check: '1', finding: 2, reason: 'x' }]
    expect(disprovedLinks(raw)).toEqual([link(1, 2, 'Why.')])
  })

  it('adds the property only when checks are shown', () => {
    const schema = { type: 'object', properties: { summary: { type: 'string' } } }
    expect(withDisproved(schema, undefined)).toBe(schema)
    expect(withDisproved(schema, [])).toBe(schema)
    expect(Object.keys(withDisproved(schema, [holds]).properties)).toEqual(['summary', 'disproved'])
  })
})

import { describe, expect, it } from 'vitest'

import type { Finding } from '../finding.mts'
import { FOCUS_PILLAR, type FocusAnswer } from '../focus.mts'
import { keptFocus } from './focus-kept.mts'

const finding = (pillar: Finding['pillar'], path?: string): Finding => ({
  pillar,
  severity: 'high',
  title: 'T',
  body: 'B',
  ...(path === undefined ? {} : { path }),
})
const fails = (point: string, path: string): FocusAnswer => ({
  point,
  status: 'does_not_hold',
  basis: 'It does not.',
  path,
  line: 3,
})

describe('keptFocus', () => {
  it('is absent without a focus', () => {
    expect(keptFocus(undefined, [finding(FOCUS_PILLAR, 'a.ts')])).toBeUndefined()
  })

  it('keeps a does_not_hold that a kept focus finding on the same path backs', () => {
    const answers = [fails('p', 'a.ts')]
    expect(keptFocus(answers, [finding(FOCUS_PILLAR, 'a.ts')])).toEqual(answers)
  })

  it('makes a does_not_hold whose finding the verifier dropped not checked', () => {
    expect(keptFocus([fails('p', 'a.ts')], [])).toEqual([
      {
        ...fails('p', 'a.ts'),
        status: 'not_checked',
        basis: `Raised, but the verifier kept no finding: ${fails('p', 'a.ts').basis}`,
      },
    ])
  })

  it('does not count another pillar, another path, or a finding with no path', () => {
    const kept = [finding('rules', 'a.ts'), finding(FOCUS_PILLAR, 'b.ts'), finding(FOCUS_PILLAR)]
    expect(keptFocus([fails('p', 'a.ts')], kept)?.[0]?.status).toBe('not_checked')
  })

  it('leaves a point on another path and the other statuses alone', () => {
    const holds: FocusAnswer = { point: 'h', status: 'holds', basis: 'Yes.', path: 'a.ts' }
    const unchecked: FocusAnswer = { point: 'u', status: 'not_checked', basis: 'Unclear.' }
    const result = keptFocus(
      [fails('dropped', 'a.ts'), fails('kept', 'b.ts'), holds, unchecked],
      [finding(FOCUS_PILLAR, 'b.ts')],
    )
    expect(result?.map((answer) => answer.status)).toEqual([
      'not_checked',
      'does_not_hold',
      'holds',
      'not_checked',
    ])
    expect(result?.[2]).toBe(holds)
    expect(result?.[3]).toBe(unchecked)
  })
})

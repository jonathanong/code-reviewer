import { describe, expect, it } from 'vitest'

import type { Finding } from '../finding.mts'
import { FOCUS_PILLAR, type FocusAnswer } from '../focus.mts'
import { focusVerifierLines, keptFocus } from './focus-kept.mts'

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

  it('appends the verifier drop reason for the dropped focus finding when one was given', () => {
    const inputs = [
      finding('rules', 'a.ts'),
      finding(FOCUS_PILLAR, 'a.ts'),
      finding(FOCUS_PILLAR, 'b.ts'),
    ]
    const dropped = new Map<number, string>([[1, 'Handled by caller validation.']])
    expect(keptFocus([fails('p', 'a.ts'), fails('q', 'b.ts')], [], inputs, dropped)).toEqual([
      {
        ...fails('p', 'a.ts'),
        status: 'not_checked',
        basis:
          'Raised, but the verifier kept no finding: It does not. Reason dropped: Handled by caller validation.',
      },
      {
        ...fails('q', 'b.ts'),
        status: 'not_checked',
        basis: 'Raised, but the verifier kept no finding: It does not.',
      },
    ])
  })
})

describe('focusVerifierLines', () => {
  it('returns nothing without focus answers', () => {
    expect(focusVerifierLines(undefined, [])).toEqual([])
    expect(focusVerifierLines([], [])).toEqual([])
  })

  it('lists focus outcomes and candidate focus finding indexes', () => {
    const withCandidate = focusVerifierLines(
      [fails('p', 'a.ts'), { point: 'u', status: 'not_checked', basis: 'Unclear.' }],
      [finding('rules', 'a.ts'), finding(FOCUS_PILLAR, 'a.ts')],
    ).join('\n\n')
    expect(withCandidate).toContain('## Requested focus checks')
    expect(withCandidate).toContain('index 1.')
    expect(withCandidate).toContain('"point": "p"')
    expect(withCandidate).toContain('"line": 3')

    const withoutCandidate = focusVerifierLines(
      [{ point: 'h', status: 'holds', basis: 'Yes.', path: 'a.ts' }],
      [finding('rules', 'a.ts')],
    ).join('\n\n')
    expect(withoutCandidate).toContain(
      'No candidate finding in `## Pillar findings` came from the `focus` step.',
    )
  })
})

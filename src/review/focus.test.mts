import { describe, expect, it } from 'vitest'

import { ReviewError, parseReviewInput } from './finding.mts'
import { focusSection, parseFocus, type FocusAnswer } from './focus.mts'
import { renderHeader } from './render.mts'

const answer = (overrides: Partial<FocusAnswer> = {}): FocusAnswer => ({
  point: 'the retry is bounded',
  status: 'holds',
  basis: 'It stops after three tries.',
  path: 'a.ts',
  line: 4,
  ...overrides,
})

describe('parseFocus', () => {
  it('is absent when the key is absent or the list is empty', () => {
    expect(parseFocus(undefined)).toEqual({})
    expect(parseFocus([])).toEqual({})
  })

  it('reads each answer, trimming and collapsing the text', () => {
    expect(
      parseFocus([
        {
          point: ' the  retry\nis bounded ',
          status: 'holds',
          basis: ' ok ',
          path: ' a.ts ',
          line: 4,
        },
        { point: 'p', status: 'not_checked', basis: 'b' },
      ]),
    ).toEqual({
      focus: [
        { point: 'the retry is bounded', status: 'holds', basis: 'ok', path: 'a.ts', line: 4 },
        { point: 'p', status: 'not_checked', basis: 'b' },
      ],
    })
  })

  it('keeps at most the supported number of points', () => {
    const many = Array.from({ length: 25 }, () => ({ point: 'p', status: 'holds', basis: 'b' }))
    expect(parseFocus(many).focus).toHaveLength(20)
  })

  it.each([
    ['not an array', {}, 'focus must be an array.'],
    ['not an object', ['x'], 'focus[0] must be an object.'],
    ['no point', [{ status: 'holds', basis: 'b' }], 'focus[0].point must be a non-empty string.'],
    ['no basis', [{ point: 'p', status: 'holds' }], 'focus[0].basis must be a non-empty string.'],
    [
      'an unknown status',
      [{ point: 'p', status: 'yes', basis: 'b' }],
      'focus[0].status must be one of',
    ],
    [
      'an empty path',
      [{ point: 'p', status: 'holds', basis: 'b', path: ' ' }],
      'focus[0].path must be a short plain file path.',
    ],
    [
      'a path with markup',
      [{ point: 'p', status: 'holds', basis: 'b', path: 'a`</details>@x' }],
      'focus[0].path must be a short plain file path.',
    ],
    [
      'a path that is not text',
      [{ point: 'p', status: 'holds', basis: 'b', path: 3 }],
      'focus[0].path must be a short plain file path.',
    ],
    [
      'a line that is not positive',
      [{ point: 'p', status: 'holds', basis: 'b', line: 0 }],
      'focus[0].line must be a positive integer.',
    ],
    [
      'a line that is not a number',
      [{ point: 'p', status: 'holds', basis: 'b', line: 'x' }],
      'focus[0].line must be a positive integer.',
    ],
  ])('rejects %s', (_name, raw, message) => {
    expect(() => parseFocus(raw)).toThrow(ReviewError)
    expect(() => parseFocus(raw)).toThrow(message)
  })

  it('is read by the review input and never changes the verdict', () => {
    const review = parseReviewInput({
      findings: [],
      focus: [{ point: 'p', status: 'does_not_hold', basis: 'b' }],
    })
    expect(review.focus).toEqual([{ point: 'p', status: 'does_not_hold', basis: 'b' }])
    expect(() => parseReviewInput({ focus: 3 })).toThrow('focus must be an array.')
    expect(parseReviewInput({}).focus).toBeUndefined()
  })
})

describe('focusSection', () => {
  it('renders nothing without answers', () => {
    expect(focusSection(undefined)).toEqual([])
    expect(focusSection([])).toEqual([])
  })

  it('is one collapsed block with a count line and a line per point', () => {
    const [block, ...rest] = focusSection([
      answer(),
      { point: 'q', status: 'holds', basis: 'It stops after three tries.', path: 'b.ts' },
      answer({ point: 'r', status: 'does_not_hold', basis: 'It is unbounded.' }),
      { point: 's', status: 'not_checked', basis: 'Not checked.' },
    ]) as [string]
    expect(rest).toEqual([])
    expect(block).toBe(
      [
        '<details><summary>Requested checks: 2 ok, 1 problem, 1 not checked</summary>',
        '',
        '- "the retry is bounded": ok. It stops after three tries. (`a.ts:4`)',
        '- "q": ok. It stops after three tries. (`b.ts`)',
        '- "r": problem. It is unbounded. (`a.ts:4`)',
        '- "s": not checked. Not checked.',
        '',
        '</details>',
      ].join('\n'),
    )
  })

  it('counts several problems', () => {
    const [block] = focusSection([
      answer({ status: 'does_not_hold' }),
      answer({ status: 'does_not_hold' }),
    ]) as [string]
    expect(block).toContain('<summary>Requested checks: 2 problem</summary>')
  })

  it('cannot close the block or mention anyone', () => {
    const [block] = focusSection([
      answer({ point: '</details> @octocat', basis: 'see @octocat </details>' }),
    ]) as [string]
    expect(block.match(/<\/details>/gu)).toHaveLength(1)
    expect(block).not.toMatch(/@\w/u)
  })

  it('is part of the review body after the questions', () => {
    const body = renderHeader(
      {
        effort: 'high',
        summary: 'S.',
        skipped: [],
        findings: [],
        questions: [],
        focus: [answer()],
      },
      'a'.repeat(40),
    )
    expect(body).toContain('<summary>Requested checks: 1 ok</summary>')
    const without = renderHeader(
      { effort: 'high', summary: 'S.', skipped: [], findings: [], questions: [] },
      'a'.repeat(40),
    )
    expect(without).not.toContain('Requested checks')
  })
})

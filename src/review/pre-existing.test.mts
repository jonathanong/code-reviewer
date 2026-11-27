import { describe, expect, it } from 'vitest'

import { indexReviewFiles } from '../review-payload/index.mts'
import { buildReviews } from './build.mts'
import { ReviewError, parseReviewInput, type Finding, type ReviewInput } from './finding.mts'
import {
  MAX_PRE_EXISTING,
  MAX_REASON_CHARS,
  PRE_EXISTING_ASK,
  PRE_EXISTING_HEADING,
  preExistingSection,
} from './pre-existing.mts'
import { actionable, deriveVerdict, renderHeader } from './render.mts'
import { countFindings } from './run/review-support.mts'

const SHA = 'c'.repeat(40)
const index = indexReviewFiles([
  { filename: 'src/a.ts', patch: '@@ -1,3 +1,4 @@\n one\n+two\n three\n four\n' },
])

function f(overrides: Partial<Finding> = {}): Finding {
  return { pillar: 'rules', severity: 'low', title: 'T', body: 'B', ...overrides }
}

function input(findings: Finding[]): ReviewInput {
  return { effort: 'high', summary: '', skipped: [], findings, questions: [] }
}

describe('parsing preExisting', () => {
  const raw = { pillar: 'rules', severity: 'high', title: 'T', body: 'B' }
  const parse = (extra: Record<string, unknown>) =>
    parseReviewInput({ findings: [{ ...raw, ...extra }] }).findings[0]

  it('keeps only true', () => {
    expect(parse({ preExisting: true })?.preExisting).toBe(true)
    expect(parse({ preExisting: false })).not.toHaveProperty('preExisting')
    expect(parse({})).not.toHaveProperty('preExisting')
  })

  it('rejects another type', () => {
    expect(() => parse({ preExisting: 'yes' })).toThrow(ReviewError)
    expect(() => parse({ preExisting: 'yes' })).toThrow(
      'findings[0].preExisting must be a boolean.',
    )
  })

  it('accepts a verdict that ignores a pre-existing blocking finding', () => {
    const review = parseReviewInput({
      verdict: 'Approve',
      findings: [{ ...raw, severity: 'blocking', preExisting: true }],
    })
    expect(review.findings).toHaveLength(1)
  })
})

describe('verdict', () => {
  it('ignores pre-existing findings of every severity', () => {
    const findings = [
      f({ severity: 'blocking', preExisting: true }),
      f({ severity: 'high', preExisting: true }),
    ]
    expect(deriveVerdict(findings, [])).toBe('Approve')
    expect(actionable(findings)).toEqual([])
  })

  it('still counts a normal finding next to one', () => {
    const findings = [f({ severity: 'high', preExisting: true }), f({ severity: 'high' })]
    expect(deriveVerdict(findings, [])).toBe('Comment')
  })

  it('leaves them out of the counts', () => {
    const findings = [f({ severity: 'high', preExisting: true }), f({ severity: 'low' })]
    expect(countFindings(findings)).toMatchObject({ high: 0, low: 1 })
    const header = renderHeader(input(findings), SHA)
    expect(header).toContain('1 finding (1 low)')
    expect(header).not.toContain('[high]')
  })
})

describe('FYI section', () => {
  it('is empty without pre-existing findings', () => {
    expect(preExistingSection([f()])).toEqual([])
  })

  it('lists one line each, worst first, with the location', () => {
    const [section] = preExistingSection([
      f({ title: 'minor', preExisting: true }),
      f({ title: 'bad\nthing', severity: 'high', path: 'src/a.ts', line: 3, preExisting: true }),
      f({ title: 'normal' }),
    ])
    expect(section).toBe(
      `${PRE_EXISTING_HEADING}\n\n- \`src/a.ts:3\` — bad thing\n  <details><summary>Why</summary>\n\n  B\n\n  </details>\n- minor\n  <details><summary>Why</summary>\n\n  B\n\n  </details>\n\n${PRE_EXISTING_ASK}`,
    )
  })

  it('collapses a multi-line reason under its item and keeps it in the list item', () => {
    const [section] = preExistingSection([
      f({ body: 'first\n\nsecond </details> end', preExisting: true }),
    ])
    expect(section).toBe(
      `${PRE_EXISTING_HEADING}\n\n- T\n  <details><summary>Why</summary>\n\n  first\n\n  second &lt;/details> end\n\n  </details>\n\n${PRE_EXISTING_ASK}`,
    )
  })

  it('escapes a closing tag with whitespace before the bracket', () => {
    const [section] = preExistingSection([
      f({ body: 'first </DETAILS >\n\nsecond', preExisting: true }),
    ])
    expect(section).toContain('first &lt;/details>\n\n  second')
    expect(section?.match(/<\/details/giu)).toHaveLength(1)
  })

  it('cuts a long reason', () => {
    const [section] = preExistingSection([f({ body: 'y'.repeat(2000), preExisting: true })])
    expect(section).toContain(`  ${'y'.repeat(MAX_REASON_CHARS - 1)}…\n`)
    expect(section).not.toContain('y'.repeat(MAX_REASON_CHARS))
  })

  it('shows just the line when there is no reason', () => {
    const [section] = preExistingSection([f({ body: ' ', preExisting: true })])
    expect(section).toBe(`${PRE_EXISTING_HEADING}\n\n- T\n\n${PRE_EXISTING_ASK}`)
  })

  it('clips a long title to one short line', () => {
    const [section] = preExistingSection([f({ title: 'x'.repeat(300), preExisting: true })])
    expect(section?.split('\n')).toContain(`- ${'x'.repeat(119)}…`)
  })

  it('caps the list and counts the rest', () => {
    const many = Array.from({ length: MAX_PRE_EXISTING + 2 }, (_, at) =>
      f({ title: `t${at}`, body: '', preExisting: true }),
    )
    const [section] = preExistingSection(many)
    expect(section?.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(
      MAX_PRE_EXISTING + 1,
    )
    expect(section).toContain('- and 2 more')
    expect(section).not.toContain('t5')
  })
})

describe('buildReviews', () => {
  it('posts a pre-existing finding only as an FYI line, never inline', () => {
    const [review] = buildReviews(
      input([
        f({ title: 'old', severity: 'high', path: 'src/a.ts', line: 2, preExisting: true }),
        f({ title: 'new', path: 'src/a.ts', line: 2 }),
      ]),
      SHA,
      index,
    )
    expect(review?.comments).toHaveLength(1)
    expect(review?.comments[0]?.body).toContain('new')
    expect(review?.body).toContain('[Approve]')
    expect(review?.body).toContain(`${PRE_EXISTING_HEADING}\n\n- \`src/a.ts:2\` — old\n  <details>`)
    expect(review?.body.indexOf('Code review')).toBeLessThan(
      review?.body.indexOf(PRE_EXISTING_HEADING) ?? -1,
    )
  })
})

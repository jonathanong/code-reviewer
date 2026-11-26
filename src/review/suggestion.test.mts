import { describe, expect, it } from 'vitest'

import { indexReviewFiles } from '../review-payload/index.mts'
import { VERIFIER_OUTPUT_SCHEMA } from './benchmark/verifier-run.mts'
import { placeFindings } from './build.mts'
import { parseReviewInput, ReviewError, type Finding } from './finding.mts'
import { renderBodyFinding, renderFindingBody } from './render.mts'

const inline: Finding = {
  pillar: 'correctness',
  severity: 'medium',
  title: 'Stray segment',
  body: 'The heading repeats the head segment.',
  path: 'src/a.mts',
  line: 2,
  side: 'RIGHT',
  suggestion: '  finish(`${heading} — ${result.reason}`)',
}

describe('the suggestion block', () => {
  it('is visible after the body and before the fix section', () => {
    const out = renderFindingBody({ ...inline, fix: 'More steps.' })
    expect(out).toBe(
      [
        '**[medium · correctness]** Stray segment',
        'The heading repeats the head segment.',
        '```suggestion\n  finish(`${heading} — ${result.reason}`)\n```',
        '<details><summary>For the fix</summary>\n\nMore steps.\n\n</details>',
      ].join('\n\n'),
    )
  })

  it('stays outside the collapsed details of a long body', () => {
    const out = renderFindingBody({ ...inline, body: 'x\n'.repeat(10) })
    expect(out.indexOf('```suggestion')).toBeGreaterThan(out.indexOf('</details>'))
  })

  it('uses the plain fence for a replacement without backticks', () => {
    expect(renderFindingBody({ ...inline, suggestion: 'a' })).toContain('```suggestion\na\n```')
  })

  it('uses a longer fence when the replacement holds backticks', () => {
    const out = renderFindingBody({ ...inline, suggestion: 'a\n```\nb\n``````\nc' })
    expect(out).toContain('```````suggestion\na\n```\nb\n``````\nc\n```````')
  })

  it('is absent without a suggestion, on a deleted line, without a line, and when pre-existing', () => {
    const { suggestion: _suggestion, ...plain } = inline
    expect(renderFindingBody(plain)).not.toContain('suggestion')
    expect(renderFindingBody({ ...inline, side: 'LEFT' })).not.toContain('```')
    const { line: _line, ...noLine } = inline
    expect(renderFindingBody(noLine)).not.toContain('```')
    const { path: _path, ...noPath } = inline
    expect(renderFindingBody(noPath)).not.toContain('```')
    expect(renderFindingBody({ ...inline, preExisting: true })).not.toContain('```')
  })

  it('is never rendered for a finding placed in the review body', () => {
    expect(renderBodyFinding(inline)).not.toContain('```')
  })

  it('is neutralised when the comment snaps to another line or loses its range', () => {
    const index = indexReviewFiles([{ filename: 'src/a.mts', patch: '@@ -1,2 +1,2 @@\n a\n b\n' }])
    const snapped = placeFindings([{ ...inline, line: 9 }], index).comments[0]
    expect(snapped?.body).toContain('Regarding')
    expect(snapped?.body).not.toContain('suggestion')
    expect(snapped?.body).toContain('```\n  finish')
    const ranged = placeFindings([{ ...inline, startLine: 1, line: 2 }], index).comments[0]
    expect(ranged?.body).toContain('```suggestion')
    expect(ranged?.start_line).toBe(1)
    const lostRange = placeFindings([{ ...inline, startLine: 7, line: 2 }], index).comments[0]
    expect(lostRange?.start_line).toBeUndefined()
    expect(lostRange?.body).not.toContain('suggestion')
  })
})

describe('the suggestion field', () => {
  const parse = (suggestion: unknown) =>
    parseReviewInput({
      findings: [{ ...inline, side: undefined, suggestion }],
    }).findings[0]

  it('keeps indentation and drops one trailing newline', () => {
    expect(parse('  a\r\n  b\n')?.suggestion).toBe('  a\n  b')
  })

  it('is absent when blank or not given', () => {
    expect(parse('  \n')?.suggestion).toBeUndefined()
    expect(parse(undefined)?.suggestion).toBeUndefined()
  })

  it('rejects a non-string', () => {
    expect(() => parse(3)).toThrow(ReviewError)
    expect(() => parse(3)).toThrow('findings[0].suggestion must be a string.')
  })

  it('is in the verifier output schema', () => {
    expect(JSON.stringify(VERIFIER_OUTPUT_SCHEMA)).toContain('"suggestion":{"type":"string"}')
  })
})

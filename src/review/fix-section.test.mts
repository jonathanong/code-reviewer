import { describe, expect, it } from 'vitest'

import { checkPostedText, visibleBody, visibleComment } from './concise.mts'
import { parseBodyFindings } from './body-findings.mts'
import { squash } from './context.mts'
import { parseReviewInput, type Finding } from './finding.mts'
import { renderBodyFinding, renderFindingBody } from './render.mts'

const base: Finding = { pillar: 'rules', severity: 'high', title: 'Title', body: 'Why it matters.' }
const FIX = 'Run:\n\n```sh\npnpm test\n```'
const raisedBy = { login: 'octo[bot]', url: 'https://example.test/t/1' }

describe('the fixer-only section', () => {
  it('collapses the fix and the prevention note into one block after the body', () => {
    const out = renderFindingBody({ ...base, fix: FIX, prevent: 'a lint rule', raisedBy })
    expect(out).toBe(
      [
        '**[high · rules]** Title\n\nWhy it matters.',
        `<details><summary>For the fix</summary>\n\n${FIX}\n\n**Prevent:** a lint rule\n\n</details>`,
        'Also raised by [octo](https://example.test/t/1)',
      ].join('\n\n'),
    )
    expect(out.match(/<details>/gu)).toHaveLength(1)
  })

  it('renders a finding without fix or prevent exactly as before', () => {
    expect(renderFindingBody(base)).toBe('**[high · rules]** Title\n\nWhy it matters.')
    expect(renderFindingBody({ ...base, raisedBy })).not.toContain('<details>')
  })

  it('cannot be closed early by the fix text, and nests inside a body finding', () => {
    const out = renderBodyFinding({ ...base, fix: 'a </details> b' })
    expect(out).toContain('a &lt;/details> b')
    expect(out.match(/<\/details>/gu)).toHaveLength(2)
    expect(visibleBody(out)).toBe('')
  })

  it('is still read back by the comment and body-finding parsers', () => {
    const inline = renderFindingBody({ ...base, fix: 'see `a:b`', prevent: 'x' })
    expect(inline).toMatch(/^\*\*\[high · rules\]\*\* Title/u)
    const body = renderBodyFinding({ ...base, path: 'a.ts', line: 3, fix: FIX })
    expect(parseBodyFindings(body)).toEqual([
      expect.objectContaining({
        severity: 'high',
        pillar: 'rules',
        title: 'Title',
        path: 'a.ts',
        line: 3,
      }),
    ])
    expect(squash(inline)).not.toContain('a:b')
  })

  it('does not count toward the visible length of an inline comment', () => {
    const long = renderFindingBody({ ...base, fix: 'x'.repeat(5000), prevent: 'p' })
    expect(visibleComment(long)).toBe('**[high · rules]** Title\n\nWhy it matters.')
    expect(visibleComment('plain')).toBe('plain')
    const input = { effort: 'low' as const, summary: '', skipped: [], findings: [], questions: [] }
    const review = {
      event: 'COMMENT' as const,
      commit_id: 'a'.repeat(40),
      body: '',
      comments: [{ path: 'a.ts', line: 1, side: 'RIGHT' as const, body: long }],
    }
    expect(checkPostedText(input, [review])).toEqual({ warnings: [], tooLong: [] })
  })

  it('parses fix as trimmed text, drops a blank one, and rejects a non-string', () => {
    const parse = (fix: unknown) =>
      parseReviewInput({
        findings: [{ pillar: 'rules', severity: 'low', title: 't', body: 'b', fix }],
      }).findings[0]
    expect(parse('  steps \n')?.fix).toBe('steps')
    expect(parse('  ')).not.toHaveProperty('fix')
    expect(() => parse(3)).toThrow('findings[0].fix must be a string.')
  })
})

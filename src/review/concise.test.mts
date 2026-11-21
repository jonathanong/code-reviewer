import { describe, expect, it } from 'vitest'

import type { SanitizedReview } from '../review-payload/index.mts'
import { checkPostedText, DEFAULT_TEXT_LIMITS, visibleBody } from './concise.mts'
import type { ReviewInput } from './finding.mts'

const SHA = 'a'.repeat(40)
const input: ReviewInput = { effort: 'low', summary: '', skipped: [], findings: [], questions: [] }

function post(body: string, ...comments: string[]): SanitizedReview[] {
  return [
    {
      event: 'COMMENT',
      commit_id: SHA,
      body,
      comments: comments.map((text, line) => ({
        path: 'a.ts',
        line: line + 1,
        side: 'RIGHT' as const,
        body: text,
      })),
    },
  ]
}

describe('visibleBody', () => {
  it('drops the hidden marker and collapsed details', () => {
    const body =
      '<!-- final-review sha=x -->\nKeep.\n<details><summary>s</summary>\n\nlong\n\n</details>'
    expect(visibleBody(body).trim()).toBe('Keep.')
  })
})

describe('visibleBody nesting', () => {
  it('hides a nested collapsed block through its outer close, and keeps text after it', () => {
    const body =
      'Top.\n<details><summary>a</summary>x<details><summary>b</summary>inner</details>still hidden</details>\nEnd.'
    expect(visibleBody(body)).toBe('Top.\n\nEnd.')
    expect(visibleBody('Keep.</details>Also.')).toBe('Keep.Also.')
    expect(visibleBody('Keep.<details open>never closed')).toBe('Keep.')
  })
})

describe('checkPostedText', () => {
  it('is quiet at the target and warns above it', () => {
    const { bodyTarget, inlineTarget } = DEFAULT_TEXT_LIMITS
    expect(bodyTarget).toBe(1200)
    expect(inlineTarget).toBe(800)
    expect(checkPostedText(input, post('x'.repeat(bodyTarget), 'y'.repeat(inlineTarget)))).toEqual({
      warnings: [],
      tooLong: [],
    })
    const over = checkPostedText(
      input,
      post('x'.repeat(bodyTarget + 1), 'y'.repeat(inlineTarget + 1)),
    )
    expect(over.warnings).toEqual([
      'review body (part 1) is 1201 characters, over its 1200 target',
      'inline comment on a.ts:1 is 801 characters, over its 800 target',
    ])
    expect(over.tooLong).toEqual([])
  })

  it('warns when a prevention note is longer than one short line', () => {
    const finding = { pillar: 'rules' as const, severity: 'low' as const, title: 't', body: 'b' }
    const quiet = { ...input, findings: [{ ...finding, prevent: 'p'.repeat(160) }, finding] }
    expect(checkPostedText(quiet, post('Short.')).warnings).toEqual([])
    const loud = { ...input, findings: [finding, { ...finding, prevent: 'p'.repeat(161) }] }
    expect(checkPostedText(loud, post('Short.')).warnings).toEqual([
      'findings[1].prevent is 161 characters, over its 160 target',
    ])
  })

  it('warns when the regression recommendation is longer than one short line', () => {
    const at = (length: number) => ({ ...input, regressionPrevent: 'r'.repeat(length) })
    expect(checkPostedText(at(160), post('Short.')).warnings).toEqual([])
    expect(checkPostedText(at(161), post('Short.')).warnings).toEqual([
      'regressionPrevent is 161 characters, over its 160 target',
    ])
  })

  it('refuses only above three times the target, and not for collapsed or hidden text', () => {
    const hidden = `<!-- ${'m'.repeat(5000)} -->\n<details>${'d'.repeat(5000)}</details>`
    expect(checkPostedText(input, post(`Short.\n${hidden}`)).warnings).toEqual([])
    const edge = checkPostedText(input, post('x'.repeat(3600), 'y'.repeat(2400)))
    expect(edge.tooLong).toEqual([])
    const long = checkPostedText(input, post('x'.repeat(3601), 'y'.repeat(2401)))
    expect(long.tooLong).toHaveLength(2)
  })

  it('honors custom targets and numbers parts', () => {
    const reviews = [...post('aaaa'), ...post('bbbbbbbb')]
    expect(checkPostedText(input, reviews, { bodyTarget: 5, inlineTarget: 5 }).warnings).toEqual([
      'review body (part 2) is 8 characters, over its 5 target',
    ])
  })

  it('adds narration warnings to the length warnings', () => {
    const narrating = { ...input, summary: 'The verifier found it.' }
    expect(checkPostedText(narrating, post('ok')).warnings).toEqual([
      expect.stringContaining('summary narrates the review'),
    ])
  })
})

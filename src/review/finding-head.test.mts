import { describe, expect, it } from 'vitest'

import { parseBodyBlocks, parseInlineHead } from './finding-head.mts'

describe('parseInlineHead', () => {
  it('reads the pillar from the severity tag', () => {
    expect(parseInlineHead('**[medium · design]** A title\n\nBody')).toEqual({
      severity: 'medium',
      pillar: 'design',
      title: 'A title',
    })
  })

  it('reads the earlier form, with the pillar in a sub line', () => {
    expect(parseInlineHead('**[high]** A title\n\n<sub>blast-radius</sub>\n\nBody')).toEqual({
      severity: 'high',
      pillar: 'blast-radius',
      title: 'A title',
    })
  })

  it('does not read a head that names no pillar, or other text', () => {
    expect(parseInlineHead('**[high]** A title\n\nBody')).toBeUndefined()
    expect(parseInlineHead('plain words')).toBeUndefined()
  })
})

describe('parseBodyBlocks', () => {
  it('reads both forms, in order, and skips a summary that names no pillar', () => {
    const body = [
      '<details><summary>[low · rules] New (`a.ts:1`)</summary>\n\nx\n\n</details>',
      '<details><summary>[blocking] Old</summary>\n\n<sub>security</sub>\n\nx\n\n</details>',
      '<details><summary>[low] No pillar</summary>\n\nx\n\n</details>',
    ].join('\n\n')
    expect(parseBodyBlocks(body)).toEqual([
      { severity: 'low', pillar: 'rules', title: 'New (`a.ts:1`)', text: 'x' },
      { severity: 'blocking', pillar: 'security', title: 'Old', text: 'x' },
    ])
  })

  it('keeps a nested collapsed section in the text and reads an unclosed block to the end', () => {
    const body = [
      '<details><summary>[high · rules] A</summary>\n\nfirst\n\n<details><summary>For the fix</summary>\n\nsteps\n\n</details>\n\n</details>',
      '<details><summary>[low · rules] B</summary>\n\nopen end',
    ].join('\n\n')
    expect(parseBodyBlocks(body).map((block) => block.text)).toEqual([
      'first\n\n<details><summary>For the fix</summary>\n\nsteps\n\n</details>',
      'open end',
    ])
  })
})

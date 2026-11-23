import { describe, expect, it } from 'vitest'

import { parseBodyHeads, parseInlineHead } from './finding-head.mts'

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

describe('parseBodyHeads', () => {
  it('reads both forms, in order, and skips a summary that names no pillar', () => {
    const body = [
      '<details><summary>[low · rules] New (`a.ts:1`)</summary>\n\nx\n\n</details>',
      '<details><summary>[blocking] Old</summary>\n\n<sub>security</sub>\n\nx\n\n</details>',
      '<details><summary>[low] No pillar</summary>\n\nx\n\n</details>',
    ].join('\n\n')
    expect(parseBodyHeads(body)).toEqual([
      { severity: 'low', pillar: 'rules', title: 'New (`a.ts:1`)' },
      { severity: 'blocking', pillar: 'security', title: 'Old' },
    ])
  })
})

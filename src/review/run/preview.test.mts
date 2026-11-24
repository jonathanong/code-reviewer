import { describe, expect, it } from 'vitest'

import { renderPreview } from './preview.mts'

const SHA = 'c'.repeat(40)

describe('renderPreview dismissal', () => {
  it('says which earlier reviews a real post would dismiss', () => {
    const base = { verdict: 'Comment' as const, event: 'COMMENT' as const, reviews: [] }
    expect(renderPreview({ ...base, wouldDismiss: [4, 5] })).toContain(
      "Would dismiss this reviewer's earlier reviews that block or approve: 4, 5.",
    )
    expect(renderPreview({ ...base, wouldDismiss: [] })).not.toContain('Would dismiss')
    expect(renderPreview(base)).not.toContain('Would dismiss')
  })
})

describe('renderPreview', () => {
  it('shows each review body and its inline comments with their places', () => {
    const text = renderPreview({
      verdict: 'Comment',
      event: 'COMMENT',
      reviews: [
        {
          event: 'COMMENT',
          commit_id: SHA,
          body: 'Header body.',
          comments: [
            { path: 'a.ts', line: 9, side: 'RIGHT', body: 'Single.' },
            {
              path: 'b.ts',
              line: 4,
              side: 'LEFT',
              start_line: 2,
              start_side: 'LEFT',
              body: 'Range.',
            },
          ],
        },
        { event: 'COMMENT', commit_id: SHA, body: 'Part two.', comments: [] },
      ],
    })
    expect(text.startsWith('# Preview: Comment\n\nPosts as COMMENT.\n')).toBe(true)
    expect(text).toContain('## Review part 1 of 2\n\nHeader body.')
    expect(text).toContain('### Inline comments (2)')
    expect(text).toContain('#### `a.ts:9` (RIGHT)\n\nSingle.')
    expect(text).toContain('#### `b.ts:2-4` (LEFT)\n\nRange.')
    expect(text).toContain('## Review part 2 of 2\n\nPart two.')
    expect(text.split('Inline comments').length).toBe(2)
  })

  it('says when the verdict was downgraded', () => {
    const text = renderPreview({
      verdict: 'Approve',
      event: 'COMMENT',
      downgraded: 'self-review',
      reviews: [],
    })
    expect(text).toContain('Posts as COMMENT (downgraded: self-review).')
  })
})

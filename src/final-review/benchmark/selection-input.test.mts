import { describe, expect, it } from 'vitest'

import { renderIndexFile, splitDiff } from '../diff-files.mts'
import { numberDiff } from '../numbered-diff.mts'
import { selectionText } from './selection-input.mts'

const DIFF = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  '',
].join('\n')

describe('selectionText', () => {
  it('takes the title from pr.md and indexes the numbered diff as prepare does', () => {
    const read: string[] = []
    const text = selectionText({ dir: '/snap', diff: DIFF, body: '' }, (path) => {
      read.push(path)
      return '# Add a column\n\nbody'
    })
    expect(read).toEqual(['/snap/.final-review/pr.md'])
    expect(text.title).toBe('Add a column')
    expect(text.index).toBe(
      renderIndexFile(splitDiff(numberDiff(DIFF)), '/snap/.final-review/diff'),
    )
    expect(text.index).toContain('`/snap/.final-review/diff/0001.patch` +1 -1 a.ts')
  })

  it('falls back to untitled when pr.md has no title', () => {
    expect(selectionText({ dir: '/snap', diff: DIFF, body: '' }, () => '#\n').title).toBe(
      '(untitled)',
    )
  })
})

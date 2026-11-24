import { describe, expect, it } from 'vitest'

import { compareDiffs, formatDelta } from './carry-diff.mts'

const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)

function patch(file: string, headerExtra: string[], hunkHeader: string, lines: string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    ...headerExtra,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    hunkHeader,
    ...lines,
    '',
  ].join('\n')
}

describe('compareDiffs', () => {
  it('treats identical per-file changes with shifted hunk positions and index hashes as equal', () => {
    const oldDiff = [
      patch('a.sql', [], '@@ -3,2 +3,2 @@', ['--- old comment', '+-- new comment']),
      patch('b.ts', [], '@@ -10,1 +10,1 @@', ['-const x = 1', '+const x = 2']),
    ].join('')
    const newDiff = [
      patch('a.sql', [], '@@ -25,2 +25,2 @@', ['--- old comment', '+-- new comment']).replace(
        '1111111..2222222',
        '3333333..4444444',
      ),
      patch('b.ts', [], '@@ -42,1 +42,1 @@', ['-const x = 1', '+const x = 2']),
    ].join('')
    const result = compareDiffs(oldDiff, newDiff, OLD, NEW)
    expect(result).toEqual({ identical: true, files: [], patch: '' })
  })

  it('treats two empty diffs as identical', () => {
    expect(compareDiffs('', '', OLD, NEW)).toEqual({ identical: true, files: [], patch: '' })
  })

  it('reports added, removed, and modified lines per differing file', () => {
    const oldDiff = [
      patch('same.ts', [], '@@ -1 +1 @@', ['-a', '+b']),
      patch('edited.ts', [], '@@ -1,2 +1,2 @@', ['-old1', '+val1', '-reverted']),
      patch('dropped.ts', [], '@@ -1 +0,0 @@', ['-gone']),
    ].join('')
    const newDiff = [
      patch('same.ts', [], '@@ -9 +9 @@', ['-a', '+b']),
      patch('edited.ts', [], '@@ -5,2 +5,2 @@', ['-old1', '+val2']),
      patch('added.ts', ['new file mode 100644'], '@@ -0,0 +1,2 @@', ['+first', '+second']),
    ].join('')
    const result = compareDiffs(oldDiff, newDiff, OLD, NEW)
    expect(result.identical).toBe(false)
    expect(result.files.map(({ path, added, removed }) => ({ path, added, removed }))).toEqual([
      { path: 'added.ts', added: 2, removed: 0 },
      { path: 'dropped.ts', added: 1, removed: 0 },
      { path: 'edited.ts', added: 2, removed: 1 },
    ])
    expect(result.patch).toContain('+new file mode 100644')
    expect(result.patch).toContain('+first')
    expect(result.patch).toContain('+gone')
    expect(result.patch).toContain('-val1')
    expect(result.patch).toContain('+val2')
    expect(result.patch).toContain('+reverted')
  })

  it('reports deletions newly introduced in the new head and removed metadata lines', () => {
    const oldDiff = [
      'diff --git a/mode.sh b/mode.sh',
      'old mode 100644',
      'new mode 100755',
      '',
    ].join('\n')
    const newDiff = patch('trim.ts', [], '@@ -1,2 +1 @@', ['-droppedLine'])
    const result = compareDiffs(oldDiff, newDiff, OLD, NEW)
    expect(result.identical).toBe(false)
    expect(result.files).toEqual([
      {
        path: 'mode.sh',
        added: 0,
        removed: 0,
        patch: expect.stringContaining('-old mode 100644\n-new mode 100755'),
      },
      {
        path: 'trim.ts',
        added: 0,
        removed: 1,
        patch: expect.stringContaining('-droppedLine'),
      },
    ])
  })

  it('handles interleaved edits, shared suffixes, and LCS backtrack branches accurately', () => {
    const oldDiff = patch('mix.ts', [], '@@ -1,4 +1,4 @@', ['+a', '+x', '+b', '+y', '+c'])
    const newDiff = patch('mix.ts', [], '@@ -1,5 +1,5 @@', ['+p', '+a', '+b', '+z', '+c', '+q'])
    const result = compareDiffs(oldDiff, newDiff, OLD, NEW)
    expect(result.identical).toBe(false)
    expect(result.files).toEqual([
      {
        path: 'mix.ts',
        added: 3,
        removed: 2,
        patch: expect.stringContaining('+p\n-x\n-y\n+z\n+q'),
      },
    ])
    const framed = compareDiffs(
      patch('framed.ts', [], '@@ -1,3 +1,3 @@', ['+top', '+old', '+tail']),
      patch('framed.ts', [], '@@ -1,3 +1,3 @@', ['+top', '+new', '+tail']),
      OLD,
      NEW,
    )
    expect(framed.files).toEqual([
      {
        path: 'framed.ts',
        added: 1,
        removed: 1,
        patch: expect.stringContaining('-old\n+new'),
      },
    ])
  })

  it('falls back cleanly without building a huge DP table when a file has a large rewrite', () => {
    const oldLines = Array.from({ length: 501 }, (_, i) => `+old-${i}`)
    const newLines = Array.from({ length: 501 }, (_, i) => `+new-${i}`)
    const oldDiff = patch('big.ts', [], '@@ -0,0 +1,501 @@', oldLines)
    const newDiff = patch('big.ts', [], '@@ -0,0 +1,501 @@', newLines)
    const result = compareDiffs(oldDiff, newDiff, OLD, NEW)
    expect(result.identical).toBe(false)
    expect(result.files[0]).toMatchObject({ path: 'big.ts', added: 501, removed: 501 })
    expect(result.files[0]?.patch).toContain('-old-0')
    expect(result.files[0]?.patch).toContain('+new-500')
  })
})

describe('formatDelta', () => {
  it('formats singular and plural differing file counts with the patch', () => {
    const single = compareDiffs(
      patch('one.ts', [], '@@ -1 +1 @@', ['+a']),
      patch('one.ts', [], '@@ -1 +1 @@', ['+b']),
      OLD,
      NEW,
    )
    expect(formatDelta(single, OLD, NEW)).toContain(
      `Delta between ${OLD.slice(0, 12)} and ${NEW.slice(0, 12)} (1 file):\n  +1 -1 one.ts`,
    )
    const plural = compareDiffs(
      '',
      patch('a.ts', [], '@@ -0,0 +1 @@', ['+1']) + patch('b.ts', [], '@@ -0,0 +1 @@', ['+2']),
      OLD,
      NEW,
    )
    expect(formatDelta(plural, OLD, NEW)).toContain('(2 files):')
    expect(formatDelta(plural, OLD, NEW)).toContain('  +1 -0 a.ts\n  +1 -0 b.ts')
  })
})

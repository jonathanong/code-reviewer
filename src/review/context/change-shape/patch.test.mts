import { describe, expect, it } from 'vitest'

import { capText, parseHunks } from './patch.mts'
import { patchOf } from './synthetic.mts'

describe('parseHunks', () => {
  it('reads verbatim lines per hunk and the path of each file', () => {
    const patch = patchOf([
      { path: 'a.ts', removed: ['  let a = 1', '-- not a header'], added: ['  const a = 1'] },
      { path: 'a.ts', removed: [], added: ['x'] },
      { path: 'dir/b.ts', removed: ['y'], added: [] },
    ])
    const { hunks, truncated } = parseHunks(patch, 10)
    expect(truncated).toBe(false)
    expect(hunks).toEqual([
      { path: 'a.ts', removed: ['  let a = 1', '-- not a header'], added: ['  const a = 1'] },
      { path: 'a.ts', removed: [], added: ['x'] },
      { path: 'dir/b.ts', removed: ['y'], added: [] },
    ])
  })

  it('stops at the hunk cap and says so', () => {
    const patch = patchOf([
      { path: 'a.ts', removed: ['1'], added: ['2'] },
      { path: 'b.ts', removed: ['3'], added: ['4'] },
    ])
    const { hunks, truncated } = parseHunks(patch, 1)
    expect(truncated).toBe(true)
    expect(hunks.map((hunk) => hunk.path)).toEqual(['a.ts'])
  })

  it('takes the old path for a deletion and ignores binary and header lines', () => {
    const patch = [
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
      '',
    ].join('\n')
    expect(parseHunks(patch, 5).hunks).toEqual([{ path: 'gone.ts', removed: ['bye'], added: [] }])
  })
})

describe('capText', () => {
  it('cuts at a line end and reports it; short text passes untouched', () => {
    expect(capText('abc\ndef\nghi', 9)).toEqual({ text: 'abc\ndef', truncated: true })
    expect(capText('abcdefgh', 4)).toEqual({ text: 'abcd', truncated: true })
    expect(capText('abc', 9)).toEqual({ text: 'abc', truncated: false })
  })
})

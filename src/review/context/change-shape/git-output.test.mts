import { describe, expect, it } from 'vitest'

import { parseCommits, parseFileChanges } from './git-output.mts'
import { file, nameStatusZ, numstatZ } from './synthetic.mts'

describe('parseFileChanges', () => {
  it('joins numstat and name-status, including renames and binary files', () => {
    const files = [
      file('a.ts', 3, 1),
      { ...file('new/b.ts', 0, 0, 'R100'), oldPath: 'old/b.ts' },
      file('c.ts', 5, 0, 'A'),
    ]
    expect(parseFileChanges(numstatZ(files), nameStatusZ(files))).toEqual(files)
    expect(parseFileChanges('-\t-\timg.png\0', 'M\0img.png\0')).toEqual([file('img.png', 0, 0)])
  })

  it('gives zero lines to a file numstat did not list and handles empty output', () => {
    expect(parseFileChanges('', 'M\0a.ts\0')).toEqual([file('a.ts', 0, 0)])
    expect(parseFileChanges('', '')).toEqual([])
    expect(parseFileChanges('1\t1\t\0', 'M\0a.ts\0')).toEqual([file('a.ts', 0, 0)])
  })
})

describe('parseCommits', () => {
  it('sums files and lines per commit and keeps order', () => {
    const log =
      '\u0001abc1234 feat: one\n\n3\t1\ta.ts\n2\t0\tb.ts\n\u0001def5678 fix: two\n\n-\t-\timg.png\n'
    expect(parseCommits(log)).toEqual([
      { id: 'abc1234', subject: 'feat: one', files: 2, added: 5, deleted: 1 },
      { id: 'def5678', subject: 'fix: two', files: 1, added: 0, deleted: 0 },
    ])
  })

  it('tolerates a header without a subject and an empty log', () => {
    expect(parseCommits('\u0001abc\n')).toEqual([
      { id: 'abc', subject: '', files: 0, added: 0, deleted: 0 },
    ])
    expect(parseCommits('')).toEqual([])
  })
})

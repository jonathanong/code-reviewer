import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  isoDate,
  parseBlame,
  parseDiffRanges,
  prNumber,
  shortSubject,
} from './git-history-parse.mts'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/history/${name}`, import.meta.url), 'utf8')

describe('parseDiffRanges', () => {
  it('returns old-side ranges, skipping pure additions, new and binary files', () => {
    expect(parseDiffRanges(fixture('diff.txt'))).toEqual([
      {
        path: 'src/app.mts',
        ranges: [
          { start: 3, count: 2 },
          { start: 10, count: 1 },
        ],
      },
      { path: 'pnpm-lock.yaml', ranges: [{ start: 1, count: 1 }] },
      { path: 'doc.md', ranges: [{ start: 1, count: 1 }] },
    ])
  })

  it('is empty for a diff that only adds lines', () => {
    expect(parseDiffRanges('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -4,0 +5 @@\n+x\n')).toEqual([])
  })
})

describe('parseBlame', () => {
  it('groups lines by commit, newest first, reading the info once per commit', () => {
    expect(parseBlame(fixture('blame.txt'))).toEqual([
      { sha: 'a'.repeat(40), time: 1700000000, subject: 'Rework parser (#12)', lines: 2 },
      { sha: 'b'.repeat(40), time: 1600000000, subject: 'Initial import', lines: 1 },
    ])
  })

  it('ignores text before the first header', () => {
    expect(parseBlame('\tstray\nnoise\n')).toEqual([])
  })
})

describe('small helpers', () => {
  it('reads a trailing pull request number only', () => {
    expect(prNumber('Fix (#12)')).toBe(12)
    expect(prNumber('Fix (#12) later')).toBeNull()
  })

  it('formats UTC dates and shortens long subjects', () => {
    expect(isoDate(1700000000)).toBe('2023-11-14')
    expect(shortSubject('x'.repeat(101))).toBe(`${'x'.repeat(97)}...`)
    expect(shortSubject('short')).toBe('short')
  })
})

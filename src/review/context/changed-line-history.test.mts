import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  MAX_COMMITS_PER_FILE,
  MAX_FILES,
  MAX_HUNKS_PER_FILE,
  MAX_LINES_PER_FILE,
  changedLineHistory,
} from './changed-line-history.mts'
import type { ContextDeps, ContextInput } from './types.mts'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/history/${name}`, import.meta.url), 'utf8')

const input: ContextInput = {
  repo: 'o/r',
  pr: 1,
  tree: '/tree',
  baseSha: 'base',
  headSha: 'head',
  out: '/out',
  skills: [],
}

type Calls = string[][]

function fake(
  diff: string,
  blame: (args: string[]) => string,
): { deps: ContextDeps; calls: Calls } {
  const calls: Calls = []
  const exec: ContextDeps['exec'] = async (_cmd, args) => {
    const git = args.slice(2)
    calls.push(git)
    if (git[0] === 'merge-base') return 'mergebase\n'
    if (git[0] === 'diff') return diff
    return blame(git)
  }
  return { deps: { exec, readFile: async () => '' }, calls }
}

const fileDiff = (path: string, hunks: string[]) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunks.join('\n')}\n`

describe('changedLineHistory', () => {
  it('blames the old side of each hunk at the merge base and lists commits newest first', async () => {
    const { deps, calls } = fake(fixture('diff.txt'), (args) =>
      args.includes('pnpm-lock.yaml') ? 'unused' : fixture('blame.txt'),
    )
    const section = await changedLineHistory.build(input, deps)
    expect(calls.find((c) => c[0] === 'diff')).toContain('base...head')
    const blames = calls.filter((c) => c[0] === 'blame')
    expect(blames).toEqual([
      ['blame', '--porcelain', '-L', '3,4', '-L', '10,10', 'mergebase', '--', 'src/app.mts'],
      ['blame', '--porcelain', '-L', '1,1', 'mergebase', '--', 'doc.md'],
    ])
    expect(section?.title).toBe('Changed-line history')
    expect(section?.body).toBe(
      [
        '### src/app.mts',
        '- `aaaaaaa` 2023-11-14 Rework parser (#12) (PR #12), 2 line(s)',
        '- `bbbbbbb` 2020-09-13 Initial import, 1 line(s)',
      ].join('\n') +
        '\n\n' +
        [
          '### doc.md',
          '- `aaaaaaa` 2023-11-14 Rework parser (#12) (PR #12), 2 line(s)',
          '- `bbbbbbb` 2020-09-13 Initial import, 1 line(s)',
        ].join('\n'),
    )
  })

  it('is empty for a diff that only adds lines', async () => {
    const { deps, calls } = fake(fileDiff('a.mts', ['@@ -4,0 +5 @@', '+x']), () => '')
    expect(await changedLineHistory.build(input, deps)).toBeNull()
    expect(calls.some((c) => c[0] === 'blame')).toBe(false)
  })

  it('turns a failed blame into a note for that file and keeps the others', async () => {
    const diff = fileDiff('a.mts', ['@@ -1 +1 @@']) + fileDiff('b.mts', ['@@ -1 +1 @@'])
    const { deps } = fake(diff, (args) => {
      if (args.includes('a.mts')) throw new Error('fatal: no such path\nmore')
      return fixture('blame.txt')
    })
    const body = (await changedLineHistory.build(input, deps))?.body ?? ''
    expect(body).toContain('### a.mts\n- not blamed: fatal: no such path')
    expect(body).toContain('### b.mts\n- `aaaaaaa`')
  })

  it('names a non-error failure', async () => {
    const { deps } = fake(fileDiff('a.mts', ['@@ -1 +1 @@']), () => {
      throw 'plain'
    })
    expect((await changedLineHistory.build(input, deps))?.body).toContain('- not blamed: plain')
  })

  it('caps hunks per file, commits per file and files, and says so', async () => {
    const hunks = Array.from({ length: MAX_HUNKS_PER_FILE + 2 }, (_, i) => `@@ -${i * 5 + 1} +1 @@`)
    const many = Array.from(
      { length: MAX_COMMITS_PER_FILE + 2 },
      (_, i) =>
        `${String(i).padStart(40, 'c')} 1 1 1\ncommitter-time ${1000 + i}\nsummary s${i}\n\tx\n`,
    ).join('')
    let diff = fileDiff('big.mts', hunks)
    for (let i = 0; i < MAX_FILES; i += 1) diff += fileDiff(`f${i}.mts`, ['@@ -1 +1 @@'])
    const { deps, calls } = fake(diff, () => many)
    const body = (await changedLineHistory.build(input, deps))?.body ?? ''
    const first = calls.find((c) => c[0] === 'blame') ?? []
    expect(first.filter((a) => a === '-L')).toHaveLength(MAX_HUNKS_PER_FILE)
    expect(calls.filter((c) => c[0] === 'blame')).toHaveLength(MAX_FILES)
    expect(body).toContain('- 2 more hunk(s) not blamed')
    expect(body).toContain('- 2 older commit(s) not listed')
    expect(body).toContain('1 more changed file(s) not blamed.')
    expect(body).not.toContain('### f19.mts')
  })

  it('skips generated files and files with too many old lines without blaming them', async () => {
    const diff =
      fileDiff('dist/out.js', ['@@ -1 +1 @@']) +
      fileDiff('gone.mts', [`@@ -1,${MAX_LINES_PER_FILE + 1} +0,0 @@`])
    const { deps, calls } = fake(diff, () => '')
    const body = (await changedLineHistory.build(input, deps))?.body
    expect(body).toBe(`### gone.mts\n- skipped: ${MAX_LINES_PER_FILE + 1} old lines`)
    expect(calls.some((c) => c[0] === 'blame')).toBe(false)
  })
})

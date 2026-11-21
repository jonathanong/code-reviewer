import { describe, expect, it } from 'vitest'

import type { ContextInput } from '../types.mts'
import { changeShape } from './index.mts'
import { summarize } from './analyze.mts'
import { splitSummary } from './split.mts'
import type { ChangeShape, Hunk } from './types.mts'
import { handWrittenOnlyRepo, mechanicalOnlyRepo, mixedRepo, smallRepo } from './split-fixtures.mts'

const input: ContextInput = {
  repo: 'o/r',
  pr: 1,
  tree: '/tree',
  baseSha: 'base',
  headSha: 'head',
  out: '/out',
  skills: [],
}
const build = (exec: ReturnType<typeof mixedRepo>) =>
  changeShape.build(input, { exec, readFile: async () => '' })

describe('the split summary of change-shape', () => {
  it('measures a large change that mixes a mechanical part with the rest', async () => {
    const section = await build(mixedRepo())
    expect(section?.split).toEqual({
      files: 49,
      lines: 362,
      mechanical: {
        lines: 160,
        files: 40,
        parts: [
          {
            what: expect.stringContaining('`let item0 = 0` -> `const item0 = 0`'),
            files: 40,
            lines: 160,
          },
        ],
      },
      explainedBy: ['.oxlintrc.json: rules.prefer-const'],
      remainder: { lines: 202 },
    })
  })

  it('gives none for a small change, which has no section at all', async () => {
    expect(await build(smallRepo())).toBeNull()
  })

  it('gives none for a purely mechanical change, though the section is still built', async () => {
    const section = await build(mechanicalOnlyRepo())
    expect(section?.title).toBe('Change shape')
    expect(section).not.toHaveProperty('split')
  })

  it('gives none for a large change with nothing mechanical', async () => {
    const section = await build(handWrittenOnlyRepo())
    expect(section?.title).toBe('Change shape')
    expect(section).not.toHaveProperty('split')
  })
})

describe('splitSummary on measured shapes', () => {
  const shape: ChangeShape = {
    files: 60,
    added: 300,
    deleted: 100,
    reviewableLines: 400,
    byDir: [],
    byKind: [],
    hunks: 0,
    top: [],
    repeatedLines: 0,
    repeatedFiles: 0,
    truncated: false,
    top1Share: 0,
    top3Share: 0,
    renames: 0,
    whitespace: { lines: 0, of: 400, files: 0 },
    configs: [],
    commits: { total: 0, capped: false, listed: [] },
    concerns: [],
    capNotes: [],
  }

  it('lists whitespace-only lines, renames and the keys that may explain it', () => {
    const summary = splitSummary({
      ...shape,
      renames: 3,
      whitespace: { lines: 150, of: 400, files: 12 },
      configs: [
        { path: '.oxfmtrc.json', keys: ['semi', 'tabWidth'], moreKeys: 2 },
        { path: 'a.toml', keys: null, moreKeys: 0 },
        { path: 'b.toml', keys: [], moreKeys: 0 },
      ],
    })
    expect(summary?.mechanical).toEqual({
      lines: 150,
      files: 12,
      parts: [
        { what: 'whitespace-only changes', files: 12, lines: 150 },
        { what: 'pure renames', files: 3, lines: 0 },
      ],
    })
    expect(summary?.explainedBy).toEqual(['.oxfmtrc.json: semi, tabWidth, ...'])
    expect(summary?.remainder.lines).toBe(250)
  })

  it('clips a long example line and tolerates a hunk with no lines on a side', () => {
    const group = (removed: string[], added: string[]) => ({
      signature: 's',
      hunks: 5,
      files: 5,
      lines: 150,
      example: { path: 'a.ts', removed, added },
    })
    const long = 'x'.repeat(300)
    const clipped = splitSummary({
      ...shape,
      repeatedLines: 150,
      repeatedFiles: 5,
      top: [group([long], [])],
    })
    expect(clipped?.mechanical.parts[0]?.what).toBe(
      `the same edit repeated, e.g. \`${'x'.repeat(100)}...\` -> \`\``,
    )
    const empty = splitSummary({
      ...shape,
      repeatedLines: 150,
      repeatedFiles: 5,
      top: [group([], ['y'])],
    })
    expect(empty?.mechanical.parts[0]?.what).toBe('the same edit repeated, e.g. `` -> `y`')
  })

  it('gives none when repeated and whitespace-only lines are disjoint and leave no remainder', () => {
    const disjoint = {
      ...shape,
      repeatedLines: 200,
      repeatedFiles: 10,
      whitespace: { lines: 200, of: 400, files: 10 },
    }
    expect(splitSummary(disjoint)).toBeNull()
    const some = splitSummary({
      ...disjoint,
      repeatedLines: 150,
      whitespace: { ...disjoint.whitespace, lines: 100 },
    })
    expect(some?.mechanical.lines).toBe(150)
    expect(some?.remainder.lines).toBe(150)
  })

  it('gives none when the patch or hunk analysis was cut at a cap', () => {
    const measured = { ...shape, repeatedLines: 150, repeatedFiles: 5 }
    expect(splitSummary(measured)).not.toBeNull()
    expect(splitSummary({ ...measured, truncated: true })).toBeNull()
  })

  it('records a cut from the measured input, and counts distinct files over all repeated groups', () => {
    const hunk = (path: string, word: string): Hunk => ({
      path,
      removed: [`${word}(x)`, 'a = 1'],
      added: word === 'alpha' ? [`${word}(y)`, 'b = 2', 'c = 3'] : [`${word}(y)`, 'b = 2'],
    })
    const kinds = ['alpha', 'beta']
    const hunks = kinds.flatMap((word) => [0, 1, 2].map((i) => hunk(`lib/${word}${i}.ts`, word)))
    const measured = {
      files: [],
      hunks,
      wLines: new Map(),
      patchTruncated: false,
      hunksTruncated: false,
      commits: [],
      commitsCapped: false,
      configs: [],
    }
    const caps = { patchBytes: 10, hunks: 2, commits: 1 }
    expect(summarize(measured, caps).top.map((group) => group.files)).toEqual([3, 3])
    expect(summarize(measured, caps).repeatedFiles).toBe(6)
    expect(summarize(measured, caps).truncated).toBe(false)
    expect(summarize({ ...measured, hunksTruncated: true }, caps).truncated).toBe(true)
    expect(summarize({ ...measured, patchTruncated: true }, caps).truncated).toBe(true)
  })

  it('gives none when the mechanical part spans too few files or lines', () => {
    expect(splitSummary({ ...shape, whitespace: { lines: 150, of: 400, files: 4 } })).toBeNull()
    expect(splitSummary({ ...shape, whitespace: { lines: 99, of: 400, files: 12 } })).toBeNull()
  })
})

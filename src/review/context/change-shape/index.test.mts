import { describe, expect, it } from 'vitest'

import type { ContextInput } from '../types.mts'
import { CAPS, changeShape } from './index.mts'
import { fakeGit, file, patchOf } from './synthetic.mts'
import type { FileChange, Hunk } from './types.mts'

const input: ContextInput = {
  repo: 'o/r',
  pr: 1,
  tree: '/tree',
  baseSha: 'base',
  headSha: 'head',
  out: '/out',
  skills: [],
}
const readFile = async () => ''

const letToConst = (path: string, index: number): Hunk => ({
  path,
  removed: [`  let item${index} = ${index}`, `  let other${index} = 'v${index}'`],
  added: [`  const item${index} = ${index}`, `  const other${index} = 'v${index}'`],
})

const oxlintBefore = JSON.stringify({ rules: { 'prefer-const': 'off', eqeqeq: 'error' } })
const oxlintAfter = JSON.stringify({ rules: { 'prefer-const': 'error', eqeqeq: 'error' } })

function lintFixRepo() {
  const sources = Array.from({ length: 30 }, (_, i) => `src/m${i}/file${i}.ts`)
  const files: FileChange[] = [
    ...sources.map((path) => file(path, 2, 2)),
    file('.oxlintrc.json', 1, 1),
  ]
  const hunks = [
    ...sources.map(letToConst),
    {
      path: '.oxlintrc.json',
      removed: ['"prefer-const": "off"'],
      added: ['"prefer-const": "error"'],
    },
  ]
  return fakeGit({
    files,
    patch: patchOf(hunks),
    mergeBase: 'mb',
    show: { 'mb:.oxlintrc.json': oxlintBefore, 'head:.oxlintrc.json': oxlintAfter },
    log: '\u0001aaa1111 chore: enable prefer-const\n\n1\t1\t.oxlintrc.json\n\u0001bbb2222 chore: fix\n\n2\t2\tsrc/m0/file0.ts\n',
  })
}

describe('change-shape: a lint auto-fix', () => {
  it('shows one signature covering the source hunks, the config key and the commits', async () => {
    const { exec } = lintFixRepo()
    const section = await changeShape.build(input, { exec, readFile })
    expect(section?.title).toBe('Change shape')
    const body = section?.body ?? ''
    expect(body).toContain('31 files, +61 -61')
    expect(body).toContain('the one repeated signature covers 97%')
    expect(body).toContain('1. 30 hunks in 30 files; example:')
    expect(body).toContain('-  let item0 = 0')
    expect(body).toContain('+  const item0 = 0')
    expect(body).toContain('- .oxlintrc.json: `rules.prefer-const`')
    expect(body).toContain('- src: 30 files, +60 -60')
    expect(body).toContain('- source: 30 files, +60 -60')
    expect(body).toContain('- config: 1 files, +1 -1')
    expect(body).toContain('2 commits.')
    expect(body).toContain('- aaa1111 chore: enable prefer-const: 1 files, +1 -1')
    expect(body).toContain('0 of 122 changed lines are whitespace-only')
    expect(body).toContain('0 files change only in whitespace.')
    expect(body).toContain('- (root) (1 hunks)')
    expect(body).not.toContain('- src (')
    expect(body).not.toContain('Caps hit')
  })
})

describe('change-shape: a mixed diff', () => {
  it('names the areas of hand-written hunks, renames, whitespace and the cap', async () => {
    const sources = Array.from({ length: 12 }, (_, i) => `src/a${i}.ts`)
    const handWritten = Array.from({ length: 6 }, (_, i): Hunk => ({
      path: `lib/h${i}.ts`,
      removed: [`call${i}(x)`],
      added: Array.from({ length: i + 1 }, (_, k) => `step${k}()`),
    }))
    const files: FileChange[] = [
      ...sources.map((path) => file(path, 2, 2)),
      ...handWritten.map((hunk) => file(hunk.path, 3, 1)),
      { ...file('docs/new.md', 0, 0, 'R100'), oldPath: 'docs/old.md' },
      file('pnpm-lock.yaml', 900, 900),
      file('.oxlintrc.json', 40, 0, 'A'),
      file('tsconfig.json', 1, 1),
      file('rustfmt.toml', 1, 1),
    ]
    const hunks = [
      ...sources.map(letToConst),
      ...handWritten,
      { path: 'pnpm-lock.yaml', removed: ['a'], added: ['b'] },
    ]
    const { exec } = fakeGit({
      files,
      patch: patchOf(hunks),
      wFiles: [...files.filter((f) => !/^src\/a[0-3]\.ts$/u.test(f.path)), file('src/a3.ts', 1, 0)],
      mergeBase: 'mb',
      show: {
        'head:.oxlintrc.json': oxlintAfter,
        'mb:tsconfig.json': '{ // c\n}',
        'head:tsconfig.json': '{}',
      },
    })
    const body = (await changeShape.build(input, { exec, readFile }))?.body ?? ''
    expect(body).toContain('1 files are pure renames (R100).')
    expect(body).toContain('15 of 116 changed lines are whitespace-only')
    expect(body).toContain('3 files change only in whitespace.')
    expect(body).toContain('- lib (6 hunks)')
    expect(body).not.toContain('- src (')
    expect(body).toContain('lockfile: 1 files, +900 -900')
    expect(body).toContain('- .oxlintrc.json: `rules.eqeqeq`, `rules.prefer-const`')
    expect(body).toContain('- tsconfig.json (changed keys not read)')
    expect(body).toContain('- rustfmt.toml (changed keys not read)')
    expect(body).toContain('0 commits.')
  })

  it('says when nothing repeats, and when caps were hit', async () => {
    const hunks = Array.from({ length: 5 }, (_, i): Hunk => ({
      path: `p${i}/f.ts`,
      removed: [`a ${'+-*/%'[i]} b`],
      added: [`a ${'+-*/%'[i]}= b`],
    }))
    const files = hunks.map((hunk) => file(hunk.path, 30, 30))
    const { exec } = fakeGit({
      files,
      patch: patchOf(hunks) + 'x'.repeat(CAPS.patchBytes),
      log: Array.from({ length: CAPS.commits }, (_, i) => `\u0001c${i} s\n\n1\t0\ta.ts\n`).join(''),
    })
    const body = (await changeShape.build(input, { exec, readFile }))?.body ?? ''
    expect(body).toContain('No change repeats in 3 or more of the 5 analysed hunks.')
    expect(body).toContain('0 of 300 changed lines are whitespace-only')
    expect(body).toContain(`At least ${CAPS.commits} commits.`)
    expect(body).toContain('... 188 more')
    expect(body).toContain(
      `Caps hit: the patch was cut at ${CAPS.patchBytes} characters; only ${CAPS.commits} commits were read.`,
    )
    expect(body).toContain('No lint, format or compiler config file changed.')
  })

  it('reports the hunk cap and a config file with no changed key', async () => {
    const hunks = Array.from({ length: CAPS.hunks + 1 }, (_, i) => letToConst('src/a.ts', i))
    const { exec } = fakeGit({
      files: [file('src/a.ts', 100, 100), file('biome.json', 1, 1)],
      patch: patchOf(hunks),
      mergeBase: 'mb',
      show: { 'mb:biome.json': '{"a":1}', 'head:biome.json': '{"a":1}' },
    })
    const body = (await changeShape.build(input, { exec, readFile }))?.body ?? ''
    expect(body).toContain(`only the first ${CAPS.hunks} hunks were analysed`)
    expect(body).toContain('- biome.json (no key changed)')
  })

  it('lists no keys without a merge base, for a missing or oversized file, and truncates many keys', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(21_000) })
    const many = JSON.stringify(
      Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i])),
    )
    const files = [
      file('src/a.ts', 100, 100),
      file('.oxlintrc.json', 1, 1),
      file('.oxlintrc.jsonc', 1, 1),
      file('tsconfig.json', 1, 1),
      file('biome.json', 1, 1, 'D'),
    ]
    const patch = patchOf([letToConst('src/a.ts', 1)])
    const noBase = fakeGit({ files, patch })
    const withoutBase =
      (await changeShape.build(input, { exec: noBase.exec, readFile }))?.body ?? ''
    expect(withoutBase).toContain('- .oxlintrc.json (changed keys not read)')
    const { exec } = fakeGit({
      files,
      patch,
      mergeBase: 'mb',
      show: {
        'mb:.oxlintrc.json': '{}',
        'head:.oxlintrc.json': many,
        'mb:tsconfig.json': big,
        'head:tsconfig.json': '{}',
        'mb:biome.json': '{"a":1}',
      },
    })
    const body = (await changeShape.build(input, { exec, readFile }))?.body ?? ''
    expect(body).toContain('`k0`, `k1`')
    expect(body).toContain(', and 5 more')
    expect(body).toContain('- .oxlintrc.jsonc (changed keys not read)')
    expect(body).toContain('- tsconfig.json (changed keys not read)')
    expect(body).toContain('- biome.json: `a`')
  })

  it('fences an example that contains backticks and clips long lines and many lines', async () => {
    const lines = Array.from({ length: 8 }, (_, i) => `x${i} = \`\`\`${'z'.repeat(200)}`)
    const hunks = Array.from({ length: 3 }, () => ({ path: 'src/a.ts', removed: lines, added: [] }))
    const { exec } = fakeGit({ files: [file('src/a.ts', 100, 100)], patch: patchOf(hunks) })
    const body = (await changeShape.build(input, { exec, readFile }))?.body ?? ''
    expect(body).toContain('````diff')
    expect(body).toContain('...')
    expect(body).toContain('-... 2 more lines')
  })

  it('reports the share of the top signature and of the top three when several repeat', async () => {
    const hunks = [
      ...Array.from({ length: 3 }, (_, i) => letToConst('src/a.ts', i)),
      ...Array.from({ length: 3 }, (_, i) => ({
        path: 'lib/b.ts',
        removed: [`old${i}()`],
        added: [`new${i}()`, 'extra()'],
      })),
    ]
    const { exec } = fakeGit({ files: [file('src/a.ts', 60, 60)], patch: patchOf(hunks) })
    const body = (await changeShape.build(input, { exec, readFile }))?.body ?? ''
    expect(body).toContain('the top signature covers 50% and the top 2 cover 100%')
    expect(body).toContain('None.')
  })

  it('never reports negative whitespace lines when -w lists more lines than the plain diff', async () => {
    const { exec } = fakeGit({
      files: [file('src/a.ts', 60, 60)],
      wFiles: [file('src/a.ts', 500, 500)],
      patch: '',
    })
    const body = (await changeShape.build(input, { exec, readFile }))?.body ?? ''
    expect(body).toContain('0 of 120 changed lines are whitespace-only')
  })

  it('counts whitespace-only lines, not hunks, and ignores generated files', async () => {
    const { exec } = fakeGit({
      files: [file('src/a.ts', 60, 60), file('pnpm-lock.yaml', 500, 500)],
      wFiles: [file('src/a.ts', 30, 30)],
      patch: '',
    })
    const body = (await changeShape.build(input, { exec, readFile }))?.body ?? ''
    expect(body).toContain('60 of 120 changed lines are whitespace-only')
    expect(body).toContain('0 files change only in whitespace.')
  })

  it('lists files by directory with a cap on rows', async () => {
    const files = Array.from({ length: 10 }, (_, i) => file(`d${i}/a.ts`, 20, 20))
    const { exec } = fakeGit({ files, patch: '' })
    const body = (await changeShape.build(input, { exec, readFile }))?.body ?? ''
    expect(body).toContain('- ... 2 more')
    expect(body).toContain('None.')
  })
})

describe('change-shape: a small diff', () => {
  it('returns null and runs no patch command', async () => {
    const files = [file('src/a.ts', 10, 10), file('pnpm-lock.yaml', 500, 500), file('b.ts', 20, 20)]
    const { exec, calls } = fakeGit({ files, patch: patchOf([letToConst('src/a.ts', 1)]) })
    expect(await changeShape.build(input, { exec, readFile })).toBeNull()
    expect(
      calls.every((args) => args.includes('--numstat') || args.includes('--name-status')),
    ).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('is exactly at the threshold null, one line over it not', async () => {
    const at = fakeGit({ files: [file('a.ts', 50, 50)], patch: '' })
    expect(await changeShape.build(input, { exec: at.exec, readFile })).toBeNull()
    const over = fakeGit({ files: [file('a.ts', 50, 51)], patch: '' })
    expect(await changeShape.build(input, { exec: over.exec, readFile })).not.toBeNull()
  })
})

describe('change-shape: git commands', () => {
  it('diffs base...head, logs base..head and runs in the checkout', async () => {
    const { exec, calls } = lintFixRepo()
    await changeShape.build(input, { exec, readFile })
    expect(
      calls.filter((args) => args[0] === 'diff').every((args) => args.at(-1) === 'base...head'),
    ).toBe(true)
    expect(calls.find((args) => args[0] === 'log')?.at(-1)).toBe('base..head')
    expect(calls.some((args) => args.includes('-w'))).toBe(true)
  })
})

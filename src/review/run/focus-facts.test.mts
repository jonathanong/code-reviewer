import { describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import {
  buildFocusFacts,
  countLines,
  frontmatterDescriptionChars,
  MAX_FOCUS_FACT_FILES,
} from './focus-facts.mts'
import { renderFocusFacts } from './focus-facts-render.mts'

const BASE = '1'.repeat(40)
const HEAD = '2'.repeat(40)

type FakeGit = {
  numstat?: string | Error
  nameStatus?: string | Error
  show?: Record<string, string | Error>
}

function fakeExec(git: FakeGit): Exec {
  return vi.fn(async (_cmd, args) => {
    if (args[0] === 'diff' && args.includes('--numstat')) {
      if (git.numstat instanceof Error) throw git.numstat
      return git.numstat ?? ''
    }
    if (args[0] === 'diff' && args.includes('--name-status')) {
      if (git.nameStatus instanceof Error) throw git.nameStatus
      return git.nameStatus ?? ''
    }
    if (args[0] === 'show') {
      const spec = args[1] as string
      const entry = git.show?.[spec]
      if (entry instanceof Error) throw entry
      if (entry === undefined) throw new Error(`missing ${spec}`)
      return entry
    }
    throw new Error(`unexpected git ${args.join(' ')}`)
  })
}

const contextReader = (context: unknown) => () => JSON.stringify(context)

describe('countLines', () => {
  it('counts empty, trailing-newline, and non-trailing-newline text', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('one\n')).toBe(1)
    expect(countLines('one\ntwo\n')).toBe(2)
    expect(countLines('one\ntwo')).toBe(2)
  })
})

describe('frontmatterDescriptionChars', () => {
  it('counts code points in YAML frontmatter description and ignores missing or invalid frontmatter', () => {
    expect(frontmatterDescriptionChars('plain text')).toBeNull()
    expect(frontmatterDescriptionChars('---\nunclosed: true\n')).toBeNull()
    expect(frontmatterDescriptionChars('---\n: bad: yaml: [\n---\n')).toBeNull()
    expect(frontmatterDescriptionChars('---\n---\nbody')).toBeNull()
    expect(frontmatterDescriptionChars('---\nname: only\n---\nbody')).toBeNull()
    expect(
      frontmatterDescriptionChars('---\nname: skill\ndescription: "café 🎉"\n---\nbody\n'),
    ).toBe(6)
    expect(
      frontmatterDescriptionChars('---\r\ndescription: >-\r\n  hello\r\n  world\r\n---\r\n'),
    ).toBe(11)
  })
})

describe('buildFocusFacts and renderFocusFacts', () => {
  it('computes facts for a normal change, rename, deleted file, binary file, and frontmatter', async () => {
    const numstat = [
      '10\t2\tsrc/a.mts',
      '5\t5\t\0src/old.mts\0src/new.mts',
      '0\t40\tsrc/gone.mts',
      '-\t-\tassets/logo.png',
      '3\t1\tskills/x/SKILL.md',
      '2\t0\tdocs/no-desc.md',
    ].join('\0')
    const nameStatus = [
      'M\0src/a.mts',
      'R100\0src/old.mts\0src/new.mts',
      'D\0src/gone.mts',
      'A\0assets/logo.png',
      'M\0skills/x/SKILL.md',
      'A\0docs/no-desc.md',
    ].join('\0')
    const exec = fakeExec({
      numstat: `${numstat}\0`,
      nameStatus: `${nameStatus}\0`,
      show: {
        [`${HEAD}:src/a.mts`]: 'line 1\nline 2\nline 3\n',
        [`${HEAD}:src/new.mts`]: 'only one line',
        [`${HEAD}:skills/x/SKILL.md`]:
          '---\nname: x\ndescription: "Check résumé ✨"\n---\n# Body\n',
        [`${HEAD}:docs/no-desc.md`]: '---\ntitle: Guide\n---\n# Guide\n',
      },
    })
    const facts = await buildFocusFacts({
      tree: '/tree',
      out: '/out',
      baseSha: BASE,
      headSha: HEAD,
      exec,
      readFile: contextReader({ title: 'Fix café 🎉', intent: { body: 'Desc — ☃️🚀' } }),
    })
    expect(facts.titleChars).toBe(10)
    expect(facts.descriptionChars).toBe(10)
    expect(facts.files?.total).toBe(6)
    expect(facts.files?.omitted).toBe(0)
    const block = renderFocusFacts(facts)
    expect(block).toBe(
      [
        '## Change facts',
        '',
        'Pull request: title 10 characters, description 10 characters.',
        '',
        'Changed files: 6.',
        '',
        '| File | Status | + | - | Lines at head | Description chars |',
        '| --- | --- | ---: | ---: | ---: | ---: |',
        '| `src/a.mts` | modified | 10 | 2 | 3 | - |',
        '| `src/new.mts` (from `src/old.mts`) | renamed | 5 | 5 | 1 | - |',
        '| `src/gone.mts` | deleted | 0 | 40 | - | - |',
        '| `assets/logo.png` | added | binary | binary | - | - |',
        '| `skills/x/SKILL.md` | modified | 3 | 1 | 5 | 14 |',
        '| `docs/no-desc.md` | added | 2 | 0 | 4 | - |',
      ].join('\n'),
    )
    // Deleted and binary files are never fetched with git show.
    const showArgs = vi
      .mocked(exec)
      .mock.calls.filter((call) => call[1][0] === 'show')
      .map((call) => call[1][1])
    expect(showArgs).not.toContain(`${HEAD}:src/gone.mts`)
    expect(showArgs).not.toContain(`${HEAD}:assets/logo.png`)
  })

  it('caps the table at 200 files with the most changed lines and states how many were omitted', async () => {
    const total = MAX_FOCUS_FACT_FILES + 5
    const numstat = Array.from({ length: total }, (_, i) =>
      i === 0 ? `-\t-\tf-${i}.png` : `${i + 1}\t0\tf-${i}.mts`,
    ).join('\0')
    const nameStatus = Array.from({ length: total }, (_, i) =>
      i === 0 ? `A\0f-${i}.png` : `A\0f-${i}.mts`,
    ).join('\0')
    const show = Object.fromEntries(
      Array.from({ length: total }, (_, i) => [`${HEAD}:f-${i}.mts`, 'x\n']),
    )
    const facts = await buildFocusFacts({
      tree: '/tree',
      out: '/out',
      baseSha: BASE,
      headSha: HEAD,
      exec: fakeExec({ numstat: `${numstat}\0`, nameStatus: `${nameStatus}\0`, show }),
      readFile: () => {
        throw new Error('no context')
      },
    })
    expect(facts.files?.total).toBe(205)
    expect(facts.files?.omitted).toBe(5)
    expect(facts.files?.listed).toHaveLength(200)
    expect(facts.files?.listed[0]?.path).toBe('f-204.mts')
    expect(facts.files?.listed.at(-1)?.path).toBe('f-5.mts')
    const block = renderFocusFacts(facts)
    expect(block).toContain(
      'Changed files: 205 (showing the 200 with the most changed lines; 5 omitted).',
    )
    expect(block).not.toContain('Description chars')
    expect(block).not.toContain('`f-0.png`')
    expect(block).toContain('`f-204.mts`')
  })

  it('leaves out a fact when git fails for it and still returns the rest', async () => {
    // 1. git show fails for one file
    const showFails = await buildFocusFacts({
      tree: '/tree',
      out: '/out',
      baseSha: BASE,
      headSha: HEAD,
      exec: fakeExec({
        numstat: ['3\t1\ta.mts', '4\t0\tb.mts', ''].join('\0'),
        nameStatus: ['M', 'a.mts', 'T', 'b.mts', ''].join('\0'),
        show: {
          [`${HEAD}:a.mts`]: new Error('bad object'),
          [`${HEAD}:b.mts`]: 'ok\n',
        },
      }),
      readFile: contextReader({ title: 'Title' }),
    })
    const showBlock = renderFocusFacts(showFails)
    expect(showBlock).toContain('Pull request: title 5 characters.')
    expect(showBlock).toContain('| `a.mts` | modified | 3 | 1 | - |')
    expect(showBlock).toContain('| `b.mts` | T | 4 | 0 | 1 |')

    // 2. git diff --numstat fails, --name-status succeeds
    const numstatFails = await buildFocusFacts({
      tree: '/tree',
      out: '/out',
      baseSha: BASE,
      headSha: HEAD,
      exec: fakeExec({
        numstat: new Error('numstat failed'),
        nameStatus: 'A\0a.mts\0',
        show: { [`${HEAD}:a.mts`]: 'a\nb\n' },
      }),
      readFile: contextReader({ intent: { body: 'Only desc' } }),
    })
    const numstatBlock = renderFocusFacts(numstatFails)
    expect(numstatBlock).toContain('Pull request: description 9 characters.')
    expect(numstatBlock).toContain('| `a.mts` | added | - | - | 2 |')

    // 3. git diff --name-status fails, --numstat succeeds
    const statusFails = await buildFocusFacts({
      tree: '/tree',
      out: '/out',
      baseSha: BASE,
      headSha: HEAD,
      exec: fakeExec({
        numstat: '1\t0\t\0old.mts\0new.mts\0',
        nameStatus: new Error('name-status failed'),
        show: { [`${HEAD}:new.mts`]: 'one\n' },
      }),
      readFile: contextReader({}),
    })
    expect(renderFocusFacts(statusFails)).toContain(
      '| `new.mts` (from `old.mts`) | - | 1 | 0 | 1 |',
    )

    // 4. both diff commands fail, PR facts still render
    const bothFail = await buildFocusFacts({
      tree: '/tree',
      out: '/out',
      baseSha: BASE,
      headSha: HEAD,
      exec: fakeExec({
        numstat: new Error('fail'),
        nameStatus: new Error('fail'),
      }),
      readFile: contextReader({ title: 'Hi', intent: { body: '' } }),
    })
    expect(renderFocusFacts(bothFail)).toBe(
      '## Change facts\n\nPull request: title 2 characters, description 0 characters.',
    )
  })

  it('handles zero changed files and returns undefined when nothing could be computed', async () => {
    const emptyDiff = await buildFocusFacts({
      tree: '/tree',
      out: '/out',
      baseSha: BASE,
      headSha: HEAD,
      exec: fakeExec({ numstat: '', nameStatus: '' }),
      readFile: contextReader({}),
    })
    expect(renderFocusFacts(emptyDiff)).toBe('## Change facts\n\nChanged files: 0.')

    const nothing = await buildFocusFacts({
      tree: '/tree',
      out: '/out',
      exec: fakeExec({}),
      readFile: () => {
        throw new Error('missing')
      },
    })
    expect(renderFocusFacts(nothing)).toBeUndefined()
  })
})

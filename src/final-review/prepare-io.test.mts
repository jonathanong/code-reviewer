import { describe, expect, it, vi } from 'vitest'

import { createGhPrepareIo } from './prepare-io.mts'

const target = { repo: 'o/r', pr: 7 }

function setup(run = vi.fn(async (_args: readonly string[]) => '')) {
  const git = vi.fn(async (_args: readonly string[]) => '')
  return { run, git, io: createGhPrepareIo(target, run, git) }
}

describe('createGhPrepareIo', () => {
  it('delegates headSha, diff and paths to the gh io', async () => {
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') return `${'a'.repeat(40)}\n`
      if (args[0] === 'pr') return 'DIFF'
      return '[{"filename":"a.ts","patch":"@@ -1 +1 @@\\n+x\\n"},{"filename":"b.md"}]'
    })
    const { io } = setup(run)
    expect(await io.headSha()).toBe('a'.repeat(40))
    expect(await io.diff()).toBe('DIFF')
    expect(await io.paths()).toEqual(['a.ts', 'b.md'])
    expect(run).toHaveBeenCalledWith(['pr', 'diff', '7', '-R', 'o/r', '--color', 'never'])
  })

  it('reads the conversation through graphql', async () => {
    const pull = { title: 'T' }
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ data: { repository: { pullRequest: pull } } }),
    )
    const { io } = setup(run)
    expect(await io.conversation()).toEqual(pull)
    expect(run.mock.calls[0]?.[0].slice(0, 2)).toEqual(['api', 'graphql'])
  })

  it('parses compare results', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({
        status: 'ahead',
        files: [{ filename: 'a.ts', additions: 2, deletions: 3 }, { filename: 'b.ts' }],
      }),
    )
    const { io } = setup(run)
    expect(await io.compare('x', 'y')).toEqual({
      status: 'ahead',
      paths: ['a.ts', 'b.ts'],
      lines: 5,
    })
    expect(run).toHaveBeenCalledWith(['api', 'repos/o/r/compare/x...y'])
  })

  it('defaults missing compare fields', async () => {
    const { io } = setup(vi.fn(async (_args: readonly string[]) => '{}'))
    expect(await io.compare('x', 'y')).toEqual({ status: 'missing', paths: [], lines: 0 })
  })

  it('treats a failing or non-JSON compare as missing', async () => {
    const missing = { status: 'missing', paths: [], lines: 0 }
    const failing = setup(
      vi.fn(async (_args: readonly string[]) => Promise.reject(new Error('404'))),
    )
    expect(await failing.io.compare('x', 'y')).toEqual(missing)
    const garbage = setup(vi.fn(async (_args: readonly string[]) => 'not json'))
    expect(await garbage.io.compare('x', 'y')).toEqual(missing)
  })

  it('requests the compare diff media type', async () => {
    const { io, run } = setup(vi.fn(async (_args: readonly string[]) => 'PATCH'))
    expect(await io.compareDiff('x', 'y')).toBe('PATCH')
    expect(run).toHaveBeenCalledWith([
      'api',
      'repos/o/r/compare/x...y',
      '-H',
      'Accept: application/vnd.github.diff',
    ])
  })

  it('lists history subjects, dropping blanks and capping paths', async () => {
    const { io, git } = setup()
    git.mockResolvedValue('one\n\n  \ntwo\n')
    const paths = Array.from({ length: 60 }, (_, i) => `f${i}.ts`)
    expect(await io.history('/tree', 'base', paths)).toEqual(['one', 'two'])
    expect(git).toHaveBeenCalledWith([
      '-C',
      '/tree',
      'log',
      '--since=12.months',
      '--format=%s',
      'base',
      '--',
      ...paths.slice(0, 50),
    ])
  })

  it('returns undefined history when git cannot read the base', async () => {
    const { io, git } = setup()
    git.mockRejectedValue(new Error('bad object'))
    expect(await io.history('/tree', 'base', ['a.ts'])).toBeUndefined()
  })

  it('marks a compare at the 300 file cap as truncated', async () => {
    const files = Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}`, additions: 1 }))
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ status: 'ahead', files }),
    )
    const { io } = setup(run)
    expect(await io.compare('x', 'y')).toMatchObject({ truncated: true, lines: 300 })
  })

  it('shares the trusted allowlist with the gh io', async () => {
    const run = vi.fn(async (_args: readonly string[]) => {
      throw new Error('no viewer')
    })
    const io = createGhPrepareIo(target, run, vi.fn(), ['App[bot]'])
    expect(await io.trusted()).toEqual(new Set(['app[bot]']))
  })
})

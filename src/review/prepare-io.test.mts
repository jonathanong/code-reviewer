import { describe, expect, it, vi } from 'vitest'

import { createGhPrepareIo } from './prepare-io.mts'

const target = { repo: 'o/r', pr: 7 }

function setup(run = vi.fn(async (_args: readonly string[]) => '')) {
  const git = vi.fn(async (_args: readonly string[]) => '')
  return {
    run,
    git,
    io: createGhPrepareIo(target, run, git, async () => undefined, undefined, '/nowhere'),
  }
}

describe('createGhPrepareIo pullCommits', () => {
  it('reads the commits of its own pull request from the REST API', async () => {
    const run = vi.fn(
      async (_args: readonly string[]) =>
        '{"sha":"s1","author":"dependabot[bot]","committer":"web-flow","verified":true}\n',
    )
    const { io } = setup(run)
    await expect(io.pullCommits()).resolves.toEqual({
      commits: [{ sha: 's1', author: 'dependabot[bot]', committer: 'web-flow', verified: true }],
      complete: true,
    })
    expect(run.mock.calls[0]?.[0][1]).toBe('repos/o/r/pulls/7/commits?per_page=100&page=1')
  })
})

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
    expect(await io.files()).toEqual([
      { path: 'a.ts', lines: 0 },
      { path: 'b.md', lines: 0 },
    ])
    expect(run).toHaveBeenCalledWith(['pr', 'diff', '7', '-R', 'o/r', '--color', 'never'])
  })

  it('classifies the push with git in the checkout', async () => {
    const { io, git } = setup()
    git.mockRejectedValue(new Error('no such commit'))
    const shas = { reviewedSha: 'r', baseSha: 'b', headSha: 'h' }
    const push = await io.push('/tree', shas)
    expect(push).toMatchObject({ kind: 'substantive', reviewedSha: 'r', headSha: 'h' })
    expect(git.mock.calls.map(([args]) => args.slice(0, 3))).toContainEqual([
      '-C',
      '/tree',
      'cat-file',
    ])
  })

  it('reads the conversation through graphql', async () => {
    const pull = {
      title: 'T',
      reviews: { nodes: [], pageInfo: { hasPreviousPage: false } },
      reviewThreads: { nodes: [], pageInfo: { hasPreviousPage: false } },
    }
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ data: { repository: { pullRequest: pull } } }),
    )
    const { io } = setup(run)
    expect(await io.conversation()).toMatchObject({ title: 'T' })
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
      sourceLines: 5,
    })
    expect(run).toHaveBeenCalledWith(['api', 'repos/o/r/compare/x...y'])
  })

  it('leaves generated files out of the compare line count', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({
        status: 'ahead',
        files: [
          { filename: 'a.ts', additions: 2, deletions: 3 },
          { filename: 'pnpm-lock.yaml', additions: 900, deletions: 100 },
        ],
      }),
    )
    expect(await setup(run).io.compare('x', 'y')).toMatchObject({ lines: 5 })
  })

  it('counts only source lines apart from tests and docs in the compare', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({
        status: 'ahead',
        files: [
          { filename: 'a.ts', additions: 1, deletions: 1 },
          { filename: 'a.test.ts', additions: 60, deletions: 0 },
          { filename: 'docs/a.md', additions: 30, deletions: 0 },
          { filename: 'skills/x/SKILL.md', additions: 3, deletions: 0 },
        ],
      }),
    )
    expect(await setup(run).io.compare('x', 'y')).toMatchObject({ lines: 95, sourceLines: 5 })
  })

  it('counts additions and deletions per listed file', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify([{ filename: 'a.ts', additions: 4, deletions: 1 }]),
    )
    expect(await setup(run).io.files()).toEqual([{ path: 'a.ts', lines: 5 }])
  })

  it('marks a renamed file', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify([{ filename: 'b.ts', status: 'renamed', additions: 1, deletions: 1 }]),
    )
    expect(await setup(run).io.files()).toEqual([{ path: 'b.ts', lines: 2, renamed: true }])
  })

  it('defaults missing compare fields', async () => {
    const { io } = setup(vi.fn(async (_args: readonly string[]) => '{}'))
    expect(await io.compare('x', 'y')).toEqual({
      status: 'missing',
      paths: [],
      lines: 0,
      sourceLines: 0,
    })
  })

  it('treats a failing or non-JSON compare as missing', async () => {
    const missing = { status: 'missing', paths: [], lines: 0, sourceLines: 0 }
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

  it('reads the tree head with git', async () => {
    const { io, git } = setup()
    git.mockResolvedValue('abc123\n')
    expect(await io.treeHead('/tree')).toBe('abc123')
    expect(git).toHaveBeenCalledWith(['-C', '/tree', 'rev-parse', 'HEAD'])
  })

  it('returns undefined history when git cannot read the base', async () => {
    const { io, git } = setup()
    git.mockRejectedValue(new Error('bad object'))
    expect(await io.history('/tree', 'base', ['a.ts'])).toBeUndefined()
  })

  it('runs a documentation search in the tree and returns its output', async () => {
    const { io, git } = setup()
    git.mockResolvedValue('docs/a.md\0 3\0text\n')
    expect(await io.docGrep('/tree', ['grep', '-e', 'x'])).toBe('docs/a.md\0 3\0text\n')
    expect(git).toHaveBeenCalledWith(['-C', '/tree', 'grep', '-e', 'x'])
  })

  it('reads a search that matched nothing (exit 1) as no output', async () => {
    const { io, git } = setup()
    git.mockRejectedValue(Object.assign(new Error('exit 1'), { code: 1 }))
    expect(await io.docGrep('/tree', ['grep'])).toBe('')
  })

  it('rethrows any other failure of the documentation search', async () => {
    const { io, git } = setup()
    const failure = Object.assign(new Error('not a repository'), { code: 128 })
    git.mockRejectedValue(failure)
    await expect(io.docGrep('/tree', ['grep'])).rejects.toBe(failure)
  })

  it('marks a compare at the 300 file cap as truncated', async () => {
    const files = Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}`, additions: 1 }))
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ status: 'ahead', files }),
    )
    const { io } = setup(run)
    expect(await io.compare('x', 'y')).toMatchObject({ truncated: true, lines: 300 })
  })

  it('finds the merged pull request that had a branch as its head, through one lookup', async () => {
    const run = vi.fn(async (_args: readonly string[]) => '12\n')
    const { io } = setup(run)
    expect(await io.mergedPull('feat/parent')).toBe(12)
    const call = run.mock.calls[0]?.[0] as string[]
    expect(call[1]).toContain('state=closed&head=o:feat%2Fparent')
    expect(call.join(' ')).toContain('select(.merged_at != null)')
  })

  it('says no pull request merged the branch when the lookup prints nothing', async () => {
    const { io } = setup(vi.fn(async () => '\n'))
    expect(await io.mergedPull('gone')).toBeUndefined()
  })

  it('hands carried-commit inspection the tree git runner', async () => {
    const { io, git } = setup()
    const found = await io.carried('/t', {
      baseSha: 'a',
      headSha: 'b',
      baseRef: null,
      parents: [],
      others: [],
    })
    expect(found.commits).toEqual([])
    expect(git).toHaveBeenCalled()
  })

  it('looks references up through one graphql call for the reviewed repository', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({
        data: {
          self: { isPrivate: false },
          r0: {
            isPrivate: false,
            issueOrPullRequest: { __typename: 'Issue', state: 'OPEN' },
          },
        },
      }),
    )
    const { io } = setup(run)
    const { found } = await io.linked([{ repo: 'o/other', number: 3 }])
    expect(found.get('o/other#3')).toMatchObject({ kind: 'issue', state: 'open' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('reads full commit messages in the range, without merges, split on NUL', async () => {
    const { io, git } = setup()
    git.mockResolvedValue('one\n\nbody\0two\n\0\n')
    expect(await io.commitMessages('/t', 'b', 'h')).toEqual(['one\n\nbody', 'two\n'])
    const args = git.mock.calls[0]?.[0] as string[]
    expect(args).toContain('--no-merges')
    expect(args.at(-1)).toBe('b..h')
  })

  it('shares the own identity with the gh io', async () => {
    const run = vi.fn(async (_args: readonly string[]) => {
      throw new Error('no viewer')
    })
    const io = createGhPrepareIo(
      target,
      run,
      vi.fn(),
      async () => 'App[bot]',
      undefined,
      '/nowhere',
    )
    expect(await io.trusted()).toEqual(new Set(['app[bot]']))
  })

  it('builds rule sources from the explicit or default clone root', async () => {
    const git = vi.fn(async (_args: readonly string[]) => '')
    const run = vi.fn(async (_args: readonly string[]) => '')
    const io = createGhPrepareIo(target, run, git, async () => undefined, '/default', '/nowhere')
    const explicit = await io.ruleSources({ clones: '/nowhere', tree: '/t', baseSha: 'abcdef012' })
    expect(explicit.repo?.refLabel).toBe('base abcdef0')
    expect(explicit.related).toEqual([])
    const fallback = await io.ruleSources({ baseSha: 'abcdef012' })
    expect(fallback.related).toEqual([])
  })

  it('reads the repository file from the default branch of the tree, else through the API', async () => {
    const run = vi.fn(async (args: readonly string[]) => {
      if (args.some((arg) => arg.endsWith('contents/.code-reviewer.json'))) {
        return '{"consumes":[{"repo":"o/api"}]}'
      }
      return args.some((arg) => arg.endsWith('/contents')) ? '.code-reviewer.json\n' : ''
    })
    const git = vi.fn(async (args: readonly string[]) => {
      if (args.includes('--abbrev-ref')) return 'origin/main\n'
      if (args[2] === 'show' && args[3]?.endsWith(':.code-reviewer.json')) {
        return '{"consumes":[{"repo":"o/lib"}]}'
      }
      if (args[2] === 'show') throw new Error('missing')
      return ''
    })
    const io = createGhPrepareIo(target, run, git, async () => undefined, undefined, '/nowhere')
    const viaTree = await io.ruleSources({ tree: '/t', baseSha: 'abcdef012' })
    expect(git).toHaveBeenCalledWith(['-C', '/t', 'show', 'origin/main:.code-reviewer.json'])
    expect(viaTree.configs?.byRepo.get('o/r')?.consumes.map((c) => c.repo)).toEqual(['o/lib'])
    const viaApi = await io.ruleSources({ baseSha: 'abcdef012' })
    expect(viaApi.configs?.byRepo.get('o/r')?.consumes.map((c) => c.repo)).toEqual(['o/api'])
  })
})

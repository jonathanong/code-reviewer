import { describe, expect, it, vi } from 'vitest'

import { fetchDefaultBranch, fetchOpenPulls } from './stack-gh.mts'

const line = (extra: Record<string, unknown>) =>
  JSON.stringify({
    number: 1,
    title: 'T',
    headRef: 'a',
    baseRef: 'main',
    headSha: 's',
    headRepo: 'o/r',
    ...extra,
  })

describe('fetchOpenPulls', () => {
  it('keeps well-formed pull requests whose head is in the repository', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      [
        line({}),
        '',
        line({ number: 2, headRepo: 'fork/r' }),
        line({ number: 3, headRepo: null }),
        line({ number: 4, title: null }),
        line({ number: 5, headRepo: 'O/R' }),
      ].join('\n'),
    )
    const pulls = await fetchOpenPulls(run, 'o/r')
    expect(pulls.map((pull) => pull.number)).toEqual([1, 5])
    expect(pulls[0]).toEqual({ number: 1, title: 'T', headRef: 'a', baseRef: 'main', headSha: 's' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0].slice(0, 2)).toEqual([
      'api',
      'repos/o/r/pulls?state=open&per_page=100&page=1',
    ])
  })

  it('reads pages until one is short', async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, at) => line({ number: from + at })).join('\n')
    const run = vi.fn(async (args: readonly string[]) =>
      args[1]?.endsWith('page=1') ? page(1, 100) : page(101, 3),
    )
    expect(await fetchOpenPulls(run, 'o/r')).toHaveLength(103)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('stops requesting pages once 500 pull requests are kept', async () => {
    const full = Array.from({ length: 100 }, (_, at) => line({ number: at + 1 })).join('\n')
    const run = vi.fn(async (_args: readonly string[]) => full)
    expect(await fetchOpenPulls(run, 'o/r')).toHaveLength(500)
    expect(run).toHaveBeenCalledTimes(5)
  })
})

describe('fetchDefaultBranch', () => {
  it('returns the trimmed branch', async () => {
    const run = vi.fn(async (_args: readonly string[]) => 'main\n')
    expect(await fetchDefaultBranch(run, 'o/r')).toBe('main')
    expect(run).toHaveBeenCalledWith(['api', 'repos/o/r', '-q', '.default_branch'])
  })

  it('throws when the branch is unknown', async () => {
    await expect(fetchDefaultBranch(async () => '\n', 'o/r')).rejects.toThrow('o/r')
  })
})

import { describe, expect, it, vi } from 'vitest'

import { MAX_COMMIT_PAGES, fetchPullCommits } from './pull-commits.mts'

const line = (sha: string) =>
  JSON.stringify({ sha, author: 'dependabot[bot]', committer: 'web-flow', verified: true })
const page = (count: number, from = 0) =>
  Array.from({ length: count }, (_, at) => line(String(from + at))).join('\n')

describe('fetchPullCommits', () => {
  it('reads the commits of the pull request in one page when it is short', async () => {
    const run = vi.fn(async (_args: readonly string[]) => page(2))
    const { commits, complete } = await fetchPullCommits(run, 'o/r', 7)
    expect(commits.map((commit) => commit.sha)).toEqual(['0', '1'])
    expect(complete).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0].slice(0, 2)).toEqual([
      'api',
      'repos/o/r/pulls/7/commits?per_page=100&page=1',
    ])
  })

  it('reads a second page when the first is full', async () => {
    const run = vi.fn(async (args: readonly string[]) =>
      args[1]?.endsWith('page=1') === true ? page(100) : page(3, 100),
    )
    const { commits, complete } = await fetchPullCommits(run, 'o/r', 7)
    expect(commits).toHaveLength(103)
    expect(complete).toBe(true)
  })

  it('stops at the page bound and says the list may be incomplete', async () => {
    const run = vi.fn(async (_args: readonly string[]) => page(100))
    const { commits, complete } = await fetchPullCommits(run, 'o/r', 7)
    expect(run).toHaveBeenCalledTimes(MAX_COMMIT_PAGES)
    expect(commits).toHaveLength(100 * MAX_COMMIT_PAGES)
    expect(complete).toBe(false)
  })

  it('rejects when GitHub fails', async () => {
    const run = vi.fn(async (_args: readonly string[]) => {
      throw new Error('HTTP 502')
    })
    await expect(fetchPullCommits(run, 'o/r', 7)).rejects.toThrow('HTTP 502')
  })
})

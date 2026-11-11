import { describe, expect, it, vi } from 'vitest'

import { fetchConversation } from './context-query.mts'

const target = { repo: 'o/r', pr: 9 }

describe('fetchConversation', () => {
  it('passes owner, name, and pr and returns the pull request', async () => {
    const pull = { title: 'T' }
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ data: { repository: { pullRequest: pull } } }),
    )
    expect(await fetchConversation(target, run)).toEqual(pull)
    const args = run.mock.calls[0]?.[0] as string[]
    expect(args.slice(0, 3)).toEqual(['api', 'graphql', '-f'])
    expect(args.slice(4)).toEqual(['-f', 'owner=o', '-f', 'name=r', '-F', 'pr=9'])
  })

  it('asks for page info so truncation is detectable', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ data: { repository: { pullRequest: {} } } }),
    )
    await fetchConversation(target, run)
    const query = (run.mock.calls[0]![0] as string[])[3] as string
    expect(query.match(/pageInfo \{ hasPreviousPage \}/gu)).toHaveLength(2)
  })

  it('throws when the pull request is missing', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ data: { repository: { pullRequest: null } } }),
    )
    await expect(fetchConversation(target, run)).rejects.toThrow('not found')
  })

  it('rejects an invalid target', async () => {
    const run = vi.fn()
    await expect(fetchConversation({ repo: 'x', pr: 1 }, run)).rejects.toThrow('--repo')
    expect(run).not.toHaveBeenCalled()
  })
})

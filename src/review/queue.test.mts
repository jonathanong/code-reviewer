import { describe, expect, it, vi } from 'vitest'

import { listQueue, scopeQualifier } from './queue.mts'
import { DEFAULT_LABELS } from './settings.mts'

describe('scopeQualifier', () => {
  it('uses org for an owner', () => {
    expect(scopeQualifier('acme', [])).toBe('org:acme')
  })

  it('lists repos when given', () => {
    expect(scopeQualifier('', ['a/b', 'c/d'])).toBe('repo:a/b repo:c/d')
  })

  it('rejects invalid input', () => {
    expect(() => scopeQualifier('bad owner', [])).toThrow('--owner')
    expect(() => scopeQualifier('acme', ['nope'])).toThrow('Invalid repo: nope')
  })
})

function reply(nodes: unknown[]): string {
  return JSON.stringify({ data: { search: { nodes } } })
}

function qOf(args: readonly string[]): string {
  return args.find((a) => a.startsWith('q=')) ?? ''
}

describe('listQueue', () => {
  it('searches both labels, maps nodes, and orders in-progress first', async () => {
    const run = vi.fn(async (args: readonly string[]) => {
      if (qOf(args).includes('final-review:held')) return reply([])
      if (qOf(args).includes('final-review:in-progress')) {
        return reply([
          { number: 2, repository: { nameWithOwner: 'a/b' } },
          { number: 3 },
          { repository: { nameWithOwner: 'a/b' } },
          {},
        ])
      }
      return reply([
        {
          number: 1,
          url: 'u',
          isDraft: true,
          updatedAt: 't',
          headRefOid: 'sha',
          repository: { nameWithOwner: 'a/b' },
        },
      ])
    })
    const entries = await listQueue(run, 'acme', [], DEFAULT_LABELS)
    expect(entries).toEqual([
      {
        repo: 'a/b',
        pr: 2,
        headSha: '',
        state: 'in-progress',
        isDraft: false,
        updatedAt: '',
        url: '',
      },
      {
        repo: 'a/b',
        pr: 1,
        headSha: 'sha',
        state: 'requested',
        isDraft: true,
        updatedAt: 't',
        url: 'u',
      },
    ])
    // Three label searches, then one open-pull-request read for the repository that has entries.
    expect(run).toHaveBeenCalledTimes(4)
    expect(run.mock.calls.filter(([args]) => args[1]?.startsWith('repos/a/b/pulls'))).toHaveLength(
      1,
    )
    const qs = run.mock.calls.map(([args]) => qOf(args)).filter((q) => q !== '')
    expect(qs.some((q) => q.includes('label:"final-review:requested"'))).toBe(true)
    expect(qs.some((q) => q.includes('label:"final-review:in-progress"'))).toBe(true)
    for (const q of qs) expect(q).toContain('org:acme is:pr is:open')
  })

  it('reports a pull request carrying the held label as held, not requested', async () => {
    const node = (number: number) => ({ number, repository: { nameWithOwner: 'a/b' } })
    const run = vi.fn(async (args: readonly string[]) => {
      const q = qOf(args)
      if (q.includes('final-review:held')) return reply([node(1)])
      if (q.includes('final-review:requested')) return reply([node(1), node(2)])
      return reply([])
    })
    const entries = await listQueue(run, 'acme', ['a/b'], DEFAULT_LABELS)
    expect(entries.map(({ pr, state }) => [pr, state])).toEqual([
      [2, 'requested'],
      [1, 'held'],
    ])
  })

  it('scopes to repos', async () => {
    const run = vi.fn(async (_args: readonly string[]) => reply([]))
    expect(await listQueue(run, '', ['a/b'], DEFAULT_LABELS)).toEqual([])
    expect(run.mock.calls[0]?.[0]).toContain(
      'q=repo:a/b is:pr is:open label:"final-review:requested" sort:updated-asc',
    )
  })
})

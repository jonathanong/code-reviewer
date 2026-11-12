import { describe, expect, it, vi } from 'vitest'

import { listQueue, scopeQualifier } from './queue.mts'

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
    const entries = await listQueue(run, 'acme')
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
    expect(run).toHaveBeenCalledTimes(2)
    const qs = run.mock.calls.map(([args]) => qOf(args))
    expect(qs.some((q) => q.includes('label:"final-review:requested"'))).toBe(true)
    expect(qs.some((q) => q.includes('label:"final-review:in-progress"'))).toBe(true)
    for (const q of qs) expect(q).toContain('org:acme is:pr is:open')
  })

  it('scopes to repos', async () => {
    const run = vi.fn(async (_args: readonly string[]) => reply([]))
    expect(await listQueue(run, '', ['a/b'])).toEqual([])
    expect(run.mock.calls[0]?.[0]).toContain(
      'q=repo:a/b is:pr is:open label:"final-review:requested" sort:updated-asc',
    )
  })
})

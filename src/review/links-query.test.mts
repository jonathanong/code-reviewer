import { describe, expect, it, vi } from 'vitest'

import { lookupLinked } from './links-query.mts'

const reply = (data: Record<string, unknown>) => JSON.stringify({ data })
const open = {
  isPrivate: false,
  issueOrPullRequest: { __typename: 'PullRequest', state: 'OPEN', merged: false },
}

describe('lookupLinked', () => {
  it('asks once for every reference and reads kind and state', async () => {
    const run = vi.fn(async (_args: string[]) =>
      reply({
        self: { isPrivate: false },
        r0: open,
        r1: {
          isPrivate: false,
          issueOrPullRequest: { __typename: 'PullRequest', state: 'MERGED', merged: true },
        },
        r2: { isPrivate: false, issueOrPullRequest: { __typename: 'Issue', state: 'CLOSED' } },
      }),
    )
    const { found, problems } = await lookupLinked(run, 'a/b', [
      { repo: 'a/b', number: 1 },
      { repo: 'c/d', number: 2 },
      { repo: 'c/d', number: 3 },
    ])
    expect(run).toHaveBeenCalledTimes(1)
    const query = run.mock.calls[0]?.[0].join(' ') as string
    expect(query).toContain('repository(owner: "c", name: "d")')
    expect(query).toContain('issueOrPullRequest(number: 3)')
    expect([...found]).toEqual([
      ['a/b#1', { kind: 'pull', state: 'open', restricted: false }],
      ['c/d#2', { kind: 'pull', state: 'merged', restricted: false }],
      ['c/d#3', { kind: 'issue', state: 'closed', restricted: false, title: '', body: '' }],
    ])
    expect(problems).toEqual([])
  })

  it('reads an issue title and body, and none for a pull request', async () => {
    const run = async () =>
      reply({
        self: { isPrivate: false },
        r0: {
          isPrivate: false,
          issueOrPullRequest: { __typename: 'Issue', state: 'OPEN', title: 'T', body: 'B' },
        },
        r1: open,
      })
    const { found } = await lookupLinked(run, 'a/b', [
      { repo: 'a/b', number: 1 },
      { repo: 'a/b', number: 2 },
    ])
    expect(found.get('a/b#1')).toMatchObject({ title: 'T', body: 'B' })
    expect(found.get('a/b#2')).not.toHaveProperty('title')
  })

  it('marks a private repository referenced from a public one as restricted', async () => {
    const run = async () =>
      reply({
        self: { isPrivate: false },
        r0: { ...open, isPrivate: true },
      })
    const { found } = await lookupLinked(run, 'a/b', [{ repo: 'c/d', number: 2 }])
    expect(found.get('c/d#2')?.restricted).toBe(true)
  })

  it('does not restrict a private repository when the reviewed one is private too', async () => {
    const run = async () => reply({ self: { isPrivate: true }, r0: { ...open, isPrivate: true } })
    const { found } = await lookupLinked(run, 'a/b', [{ repo: 'c/d', number: 2 }])
    expect(found.get('c/d#2')?.restricted).toBe(false)
  })

  it('reports a reference that is not found, and keeps the ones that are', async () => {
    const run = async () => reply({ self: { isPrivate: false }, r0: open, r1: null })
    const { found, problems } = await lookupLinked(run, 'a/b', [
      { repo: 'a/b', number: 1 },
      { repo: 'a/b', number: 404 },
    ])
    expect([...found.keys()]).toEqual(['a/b#1'])
    expect(problems).toEqual(['Could not read a/b#404: not found, or not visible to this account.'])
  })

  it('treats a node without a state as unreadable', async () => {
    const run = async () => reply({ r0: { isPrivate: false, issueOrPullRequest: {} } })
    const { found } = await lookupLinked(run, 'a/b', [{ repo: 'a/b', number: 1 }])
    expect(found.size).toBe(0)
  })

  it('uses the partial answer of a call that failed on one missing reference', async () => {
    const run = async () => {
      throw Object.assign(new Error('exit status 1'), {
        stdout: reply({ self: { isPrivate: false }, r0: open, r1: null }),
      })
    }
    const { found, problems } = await lookupLinked(run, 'a/b', [
      { repo: 'a/b', number: 1 },
      { repo: 'a/b', number: 2 },
    ])
    expect(found.has('a/b#1')).toBe(true)
    expect(problems).toHaveLength(1)
  })

  it('records a failed call with no answer as one problem and throws nothing', async () => {
    const failing = async () => {
      throw new Error('rate limited\nsecond line')
    }
    expect(await lookupLinked(failing, 'a/b', [{ repo: 'a/b', number: 1 }])).toEqual({
      found: new Map(),
      problems: ['Linked pull requests and issues could not be read: rate limited'],
    })
    const stringFailure = async () => {
      throw 'offline'
    }
    expect(
      (await lookupLinked(stringFailure, 'a/b', [{ repo: 'a/b', number: 1 }])).problems[0],
    ).toContain('offline')
  })

  it('records an answer that is not JSON, or has no data, as unreadable', async () => {
    const garbled = async () => {
      throw Object.assign(new Error('bad'), { stdout: '{not json' })
    }
    expect(
      (await lookupLinked(garbled, 'a/b', [{ repo: 'a/b', number: 1 }])).problems,
    ).toHaveLength(1)
    const empty = async () => '{}'
    expect((await lookupLinked(empty, 'a/b', [{ repo: 'a/b', number: 1 }])).problems).toHaveLength(
      1,
    )
  })

  it('never puts an unsafe name in the query, and asks nothing for no reference', async () => {
    const run = vi.fn(async (_args: string[]) => reply({}))
    expect(await lookupLinked(run, 'a/b', [])).toEqual({ found: new Map(), problems: [] })
    await lookupLinked(run, 'a/b', [{ repo: 'x"y/z', number: 1 }])
    expect(run).not.toHaveBeenCalled()
  })
})

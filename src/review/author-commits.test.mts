import { describe, expect, it, vi } from 'vitest'

import { planAuthor } from './author-commits.mts'
import type { AuthorRule } from './author-rules.mts'
import type { PullCommit, PullCommits } from './pull-commits.mts'

const HEAD = 'a'.repeat(40)
const BOT = { login: 'dependabot[bot]', __typename: 'Bot' }
const commit = (overrides: Partial<PullCommit> = {}): PullCommit => ({
  sha: HEAD,
  author: 'dependabot[bot]',
  committer: 'web-flow',
  verified: true,
  ...overrides,
})
const io = (listed: PullCommits) => ({ pullCommits: vi.fn(async () => listed) })
const suspension = async (commits: PullCommit[], complete = true) =>
  (await planAuthor(io({ commits, complete }), BOT, [], HEAD)).authorSuspended

describe('planAuthor commit attribution', () => {
  it.each([
    ['GitHub made and signed it for the bot', commit()],
    ['the bot committed and signed it', commit({ committer: 'dependabot[bot]' })],
    ['the account name has another form', commit({ author: 'app/Dependabot' })],
  ])('keeps the rule when %s', async (_name, input) => {
    await expect(suspension([input])).resolves.toBeUndefined()
  })

  it.each([
    ['another account authored it', commit({ author: 'alice' })],
    ['the author resolves to no account', commit({ author: null })],
    ['someone else committed it, claiming the bot as author', commit({ committer: 'alice' })],
    ['the committer is unknown', commit({ committer: null })],
    ['the signature is not verified', commit({ verified: false })],
  ])('suspends the rule when %s', async (_name, input) => {
    await expect(suspension([input])).resolves.toBe(
      'Commits by others on a dependabot[bot] pull request: normal review.',
    )
  })

  it('suspends the rule when only an earlier commit is someone else', async () => {
    const earlier = commit({ sha: 'b'.repeat(40), author: 'alice', committer: 'alice' })
    await expect(suspension([earlier, commit()])).resolves.toContain('Commits by others')
  })

  it('keeps the rule when several commits are all the bot', async () => {
    await expect(suspension([commit({ sha: 'b'.repeat(40) }), commit()])).resolves.toBeUndefined()
  })

  it('suspends the rule when the lookup fails', async () => {
    const failing = {
      pullCommits: async (): Promise<PullCommits> => {
        throw new Error('boom')
      },
    }
    const planned = await planAuthor(failing, BOT, [], HEAD)
    expect(planned.authorSuspended).toBe(
      'Could not read the commits of this dependabot[bot] pull request: normal review.',
    )
  })

  it('suspends the rule when the commits may not all have been read', async () => {
    await expect(suspension([commit()], false)).resolves.toContain('More commits than')
  })

  it.each([
    ['empty', []],
    ['not ending at the head', [commit({ sha: 'b'.repeat(40) })]],
  ])('suspends the rule when the list is %s', async (_name, commits) => {
    await expect(suspension(commits)).resolves.toContain('do not end at its head')
  })
})

describe('planAuthor', () => {
  it('reports the author and reads no commits when no rule applies', async () => {
    const forbidden = io({ commits: [], complete: true })
    const person = { login: 'alice', __typename: 'User' }
    await expect(planAuthor(forbidden, person, [], HEAD)).resolves.toEqual({
      authorLogin: 'alice',
      authorIsBot: false,
    })
    await expect(planAuthor(forbidden, null, [], HEAD)).resolves.toEqual({
      authorLogin: null,
      authorIsBot: false,
    })
    expect(forbidden.pullCommits).not.toHaveBeenCalled()
  })

  it('checks the commits of an author a configured rule names', async () => {
    const rules: AuthorRule[] = [{ login: 'alice', review: 'skip' }]
    const person = { login: 'alice', __typename: 'User' }
    const mine = commit({ author: 'alice', committer: 'alice' })
    const own = io({ commits: [mine], complete: true })
    await expect(planAuthor(own, person, rules, HEAD)).resolves.toEqual({
      authorLogin: 'alice',
      authorIsBot: false,
    })
    expect(own.pullCommits).toHaveBeenCalledTimes(1)
    const others = io({ commits: [commit()], complete: true })
    expect((await planAuthor(others, person, rules, HEAD)).authorSuspended).toContain('by others')
  })
})

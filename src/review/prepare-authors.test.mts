import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_PLAN_VALUES } from './plan-settings.mts'
import { prepareReview } from './prepare.mts'
import { HEAD, fakeIo } from './prepare-fake-io.mts'

let out: string
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'prepare-authors-'))
})
afterEach(() => rmSync(out, { recursive: true, force: true }))

const BOT = { login: 'dependabot[bot]', __typename: 'Bot' }
const WORKFLOW = ['.github/workflows/ci.yml']
const botCommit = { sha: HEAD, author: 'dependabot[bot]', committer: 'web-flow', verified: true }
const planned = () => JSON.parse(readFileSync(join(out, 'plan.json'), 'utf8'))

function withCommits(commits: (typeof botCommit)[], paths = WORKFLOW) {
  const io = fakeIo({ author: BOT, paths })
  io.pullCommits.mockResolvedValue({ commits, complete: true })
  return io
}

describe('prepareReview author rules', () => {
  it('keeps the light plan, without security triggers, while every commit is the bot', async () => {
    const io = withCommits([botCommit])
    const summary = await prepareReview(io, { out })
    expect(summary.mode).toBe('light')
    expect(summary.plan.pillars.map((p) => p.pillar)).not.toContain('security')
    expect(io.pullCommits).toHaveBeenCalledTimes(1)
  })

  it('plans the normal review, with the security pillar, once a person pushed a commit', async () => {
    const person = { ...botCommit, sha: 'd'.repeat(40), author: 'alice', committer: 'alice' }
    const summary = await prepareReview(withCommits([person, botCommit]), { out })
    expect(summary.mode).toBe('full')
    expect(summary.plan.pillars.map((p) => p.pillar)).toContain('security')
    expect(planned().reasons).toContain(
      'Commits by others on a dependabot[bot] pull request: normal review.',
    )
  })

  it('plans the normal review for a commit that claims the bot but is not verified', async () => {
    const forged = { ...botCommit, verified: false }
    const summary = await prepareReview(withCommits([forged]), { out })
    expect(summary.mode).toBe('full')
  })

  it('plans the normal review when the commits cannot be read', async () => {
    const io = withCommits([botCommit])
    io.pullCommits.mockRejectedValue(new Error('HTTP 502'))
    const summary = await prepareReview(io, { out })
    expect(summary.mode).toBe('full')
    expect(planned().reasons).toContain(
      'Could not read the commits of this dependabot[bot] pull request: normal review.',
    )
  })

  it('does not skip a lockfile-only pull request someone else pushed to', async () => {
    const person = { ...botCommit, author: 'alice', committer: 'alice' }
    const summary = await prepareReview(withCommits([person], ['pnpm-lock.yaml']), { out })
    expect(summary.mode).not.toBe('skip')
  })

  it('skips a pull request by a skip-rule author while the commits are theirs', async () => {
    const io = fakeIo({ author: { login: 'renovate[bot]', __typename: 'Bot' } })
    io.pullCommits.mockResolvedValue({
      commits: [{ ...botCommit, author: 'renovate[bot]' }],
      complete: true,
    })
    const values = {
      ...DEFAULT_PLAN_VALUES,
      authors: [{ login: 'renovate', review: 'skip' as const }],
    }
    expect((await prepareReview(io, { out, values })).mode).toBe('skip')
    io.pullCommits.mockResolvedValue({ commits: [botCommit], complete: true })
    expect((await prepareReview(io, { out, values })).mode).not.toBe('skip')
  })

  it('reads no commits when no author rule applies', async () => {
    const io = fakeIo({ author: { login: 'alice', __typename: 'User' } })
    await prepareReview(io, { out })
    expect(io.pullCommits).not.toHaveBeenCalled()
  })
})

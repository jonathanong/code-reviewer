import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../review/index.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../review/index.mts')>()),
  claimReview: vi.fn(async () => ({ claimed: true })),
  abortReview: vi.fn(async () => ({ added: [] })),
  skipPullRequest: vi.fn(async () => ({
    headSha: 'h'.repeat(40),
    url: 'https://example.test/skip',
    added: ['done'],
    removed: ['busy'],
  })),
  reviewStatus: vi.fn(async () => ({ current: false })),
}))

import { claimReview, reviewStatus } from '../review/index.mts'
import { runLoopCommand } from './command-loop.mts'
import { BOB, fakeDeps } from './command-loop-fake-io.mts'

afterEach(() => {
  vi.clearAllMocks()
})

describe('runLoopCommand', () => {
  describe('check run', () => {
    /** The writes only: a completing step first looks its run up with a GET. */
    const writes = (run: { mock: { calls: unknown[][] } }) =>
      run.mock.calls.map(([args]) => args as string[]).filter((args) => args.includes('--method'))
    const posts = (run: { mock: { calls: unknown[][] } }) =>
      writes(run).map((args) => args.filter((a) => /^(status|conclusion)=/u.test(a)))

    it('starts on a claim and completes on abort and skip', async () => {
      const { deps, run } = fakeDeps()
      const claimed = await runLoopCommand('claim', { force: true }, () => BOB, deps)
      expect(claimed).toEqual({
        claimed: true,
        checkRun: { status: 'in_progress', url: 'https://example.test/check', via: 'check-run' },
      })
      await runLoopCommand('abort', {}, () => BOB, deps)
      await runLoopCommand('skip', { reason: 'docs only' }, () => BOB, deps)
      expect(posts(run)).toEqual([
        ['status=in_progress'],
        ['status=completed', 'conclusion=cancelled'],
        ['status=completed', 'conclusion=skipped'],
      ])
    })

    it('binds the check run to the head the claim read, and reads the head once for abort and skip', async () => {
      const claimHead = 's'.repeat(40)
      const { deps, run } = fakeDeps()
      vi.mocked(reviewStatus).mockResolvedValueOnce({
        current: false,
        headSha: claimHead,
      } as never)
      await runLoopCommand('claim', {}, () => BOB, deps)
      await runLoopCommand('abort', {}, () => BOB, deps)
      const heads = writes(run).map((args) => args.find((a) => a.startsWith('head_sha=')))
      expect(heads).toEqual([`head_sha=${claimHead}`, `head_sha=${'h'.repeat(40)}`])
    })

    it('uses the head run passes for the claim and the abort, never the live head', async () => {
      const claimed = 'r'.repeat(40)
      const { deps, run } = fakeDeps()
      await runLoopCommand('claim', { force: true, headSha: claimed }, () => BOB, deps)
      await runLoopCommand('abort', { reason: 'boom', headSha: claimed }, () => BOB, deps)
      expect(run.mock.calls[1]?.[0]).toContain(
        `repos/bob/c/commits/${claimed}/check-runs?check_name=Code%20review&per_page=100`,
      )
      const [, abort] = writes(run)
      expect(abort).toContain('conclusion=cancelled')
      expect(abort).toContain('output[summary]=boom')
    })

    it('completes a held abort as action_required, linking the pull request', async () => {
      const { deps, run } = fakeDeps()
      await runLoopCommand('abort', { hold: true, reason: 'flagged: 1 flag(s)' }, () => BOB, deps)
      const [held] = writes(run)
      expect(held).toContain('conclusion=action_required')
      expect(held).toContain('details_url=https://github.com/bob/c/pull/4')
      expect(held).toContain('output[title]=Held for a person: flagged: 1 flag(s)')
    })

    it('says a person must post it when a hold gives no reason', async () => {
      const { deps, run } = fakeDeps()
      await runLoopCommand('abort', { hold: true }, () => BOB, deps)
      expect(writes(run)[0]).toContain('output[title]=Held for a person: a person must post it')
    })

    it('does not start one for a declined claim', async () => {
      const { deps, run } = fakeDeps()
      vi.mocked(claimReview).mockResolvedValueOnce({
        claimed: false,
        reason: 'already in progress',
        labels: [],
      })
      await runLoopCommand('claim', { force: true }, () => BOB, deps)
      expect(run).not.toHaveBeenCalled()
    })

    it('writes a commit status instead of a check run under the gh login', async () => {
      const { deps, run } = fakeDeps('gh')
      const result = await runLoopCommand('abort', {}, () => BOB, deps)
      expect(result).toMatchObject({
        checkRun: { status: 'completed', via: 'commit-status' },
      })
      const args = run.mock.calls[0]?.[0] as string[]
      expect(args).toContain(`repos/bob/c/statuses/${'h'.repeat(40)}`)
      expect(args).toContain('state=error')
    })
  })
})

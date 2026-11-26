import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../cli/command-review.mts', () => ({ reviewCommand: vi.fn() }))

import { reviewCommand } from '../cli/command-review.mts'
import { runReviewCommand } from '../cli/command.mts'
import { processRetrier } from '../gh-cli/retry.mts'
import type { FakeOptions } from './fake-deps.mts'
import { PULL, runWith, setup as makeFake, type Review } from './harness.mts'

let root: string
let stdout: string[]
let stderr: string[]

const setup = (options: Partial<FakeOptions> = {}, review: Review = {}) =>
  makeFake(root, options, review)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'run-outcome-'))
  mkdirSync(join(root, 'tmp'))
  stdout = []
  stderr = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  vi.mocked(reviewCommand).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('run reading the post outcome', () => {
  it('carries the confirmed review ids and the approval check', async () => {
    const fake = setup({}, { approvalCheck: 'upheld' })
    const { code, lines } = await runWith(fake, stdout)
    expect(code).toBe(0)
    expect(lines[0]).toMatchObject({
      reviewIds: [1],
      reviewUrl: 'https://github.example/review/1',
      approvalCheck: 'upheld',
      attention: [],
    })
  })

  it('posts a forced re-review of a head this reviewer already posted', async () => {
    const fake = setup()
    expect((await runWith(fake, stdout)).code).toBe(0)
    expect(fake.io.postReview).toHaveBeenCalledOnce()
    stdout.length = 0
    expect((await runWith(fake, stdout, { ...PULL, force: true })).code).toBe(0)
    expect(fake.io.postReview).toHaveBeenCalledTimes(2)
  })

  it('has no approval check when the review ran none', async () => {
    const { lines } = await runWith(setup(), stdout)
    expect(lines[0]).toMatchObject({ approvalCheck: null })
  })

  it('holds an approval whose second check did not complete', async () => {
    const report = { skipped: [{ pillar: 'approval-check', reason: 'timed out' }] }
    const fake = setup({}, { approvalCheck: 'failed', overrides: { report } })
    const { code, lines } = await runWith(fake, stdout)
    expect(code).toBe(10)
    expect(lines[0]).toMatchObject({
      held: ['partial-failure'],
      approvalCheck: 'failed',
      problems: ['the approval was not double-checked'],
    })
    expect(fake.io.postReview).not.toHaveBeenCalled()
  })

  it('holds a review with a flag, reports it in the JSON line, and does not post', async () => {
    const flags = [{ kind: 'irreversible', concern: 'Drops a column.' }]
    const fake = setup({}, { overrides: { review: { flags } } })
    const { code, lines } = await runWith(fake, stdout)
    expect(code).toBe(10)
    expect(lines[0]).toMatchObject({ outcome: 'held', held: ['flagged'], flags: ['irreversible'] })
    expect(lines[0]?.attention).toEqual(['flagged: 1 flag(s): irreversible'])
    expect(fake.io.postReview).not.toHaveBeenCalled()
  })

  it('reports a review whose read-back failed as posted, with the warnings to look at', async () => {
    const fake = setup()
    vi.mocked(fake.io.postReview).mockImplementation(async () => {
      vi.mocked(fake.io.listReviews).mockRejectedValue(new Error('read failed'))
      return 'https://github.example/review/9'
    })
    const { code, lines } = await runWith(fake, stdout)
    expect(code).toBe(0)
    expect(lines[0]?.reviewIds).toEqual([])
    expect(lines[0]?.problems).toEqual(['the review was not confirmed on the pull request'])
    expect(lines[0]?.attention.join(' ')).toContain('could not be confirmed')
  })

  it('keeps a wording warning out of attention on a posted review', async () => {
    const fake = setup({}, { overrides: { review: { summary: 'Fine. '.repeat(260) } } })
    const { code, lines } = await runWith(fake, stdout)
    expect(code).toBe(0)
    expect(vi.mocked(fake.io.postReview).mock.calls[0]?.[0].body.length).toBeGreaterThan(1200)
    expect(lines[0]?.attention).toEqual([])
  })

  it.each([
    ['a submitted review missing from the list', true],
    ['a failed post that cannot be checked for', false],
  ])('fails without inviting a second review for %s', async (_name, missing) => {
    const fake = setup({ unconfirmed: missing })
    if (!missing) {
      vi.mocked(fake.io.postReview).mockImplementation(async () => {
        vi.mocked(fake.io.listReviews).mockRejectedValue(new Error('read failed'))
        throw new Error('HTTP 502: Bad Gateway')
      })
    }
    const { code, lines } = await runWith(fake, stdout)
    expect(code).toBe(13)
    expect(lines[0]?.reason).toContain('may or may not have posted; look at the pull request')
    expect(lines[0]?.postCommand).toBeNull()
    expect(fake.labels).toEqual([])
    stdout.length = 0
    vi.mocked(fake.io.listReviews).mockReset().mockResolvedValue([])
    const again = await runWith(fake, stdout)
    expect(again.code).toBe(11)
    expect(again.lines[0]?.reason).toContain('an unposted review of this head waits in')
    expect(vi.mocked(reviewCommand)).toHaveBeenCalledOnce()
  })
})

describe('run --max-cost and --quiet', () => {
  it('hands both flags to the review, and neither when not given', async () => {
    await runWith(setup(), stdout, { ...PULL, 'max-cost': '2.5', quiet: true })
    expect(vi.mocked(reviewCommand).mock.calls[0]?.[0]).toMatchObject({
      'max-cost': '2.5',
      quiet: true,
    })
    vi.mocked(reviewCommand).mockClear()
    await runWith(setup(), stdout)
    const passed = vi.mocked(reviewCommand).mock.calls[0]?.[0] as object
    expect(passed).not.toHaveProperty('max-cost')
    expect(passed).not.toHaveProperty('quiet')
  })

  it.each(['0', '-1', 'lots'])('refuses --max-cost %s before anything is claimed', async (cost) => {
    const fake = setup()
    const { code, lines } = await runWith(fake, stdout, { ...PULL, 'max-cost': cost })
    expect(code).toBe(12)
    expect(lines[0]?.reason).toBe('--max-cost must be a number of US dollars greater than 0.')
    expect(vi.mocked(reviewCommand)).not.toHaveBeenCalled()
  })
})

describe('run and GitHub retries', () => {
  it('keeps the retry warning on stderr and stdout to one JSON line', async () => {
    const fake = setup({ plugins: [] })
    processRetrier.stats.retries = 2
    await expect(
      runReviewCommand(['run', '--repo', 'acme/widgets', '--pr', '4'], fake.deps),
    ).resolves.toBe(12)
    expect(stdout).toHaveLength(1)
    expect(JSON.parse(stdout[0] as string)).toMatchObject({ outcome: 'error', exitCode: 12 })
    expect(stderr.join('')).toContain('2 GitHub calls were retried')
  })
})

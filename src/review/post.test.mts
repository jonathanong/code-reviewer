import { describe, expect, it, vi, type Mock } from 'vitest'

import { postReviews } from './event.mts'
import { ReviewError, type ReviewInput } from './finding.mts'
import { ReviewRejectedError, type ReviewIo } from './github.mts'
import { reviewStatus, postFinalReview, revokeFinalApproval } from './post.mts'
import { reviewMarker, type Verdict } from './render.mts'

const SHA = 'c'.repeat(40)
const OTHER = 'd'.repeat(40)

const asReviews = (bodies: string[], author = 'bot') => bodies.map((body) => ({ body, author }))

type MockIo = { [K in keyof ReviewIo]: Mock<ReviewIo[K]> }

function fakeIo(overrides: Partial<MockIo> = {}): MockIo {
  return {
    headSha: vi.fn(async () => SHA),
    diff: vi.fn(async () => ''),
    listFiles: vi.fn(async () => [{ filename: 'a.ts', patch: '@@ -1 +1 @@\n+x\n' }]),
    listReviews: vi.fn(async () => asReviews([])),
    trustedAuthors: vi.fn(async () => new Set(['bot'])),
    pullAuthor: vi.fn(async () => 'dev'),
    hasApprovalLabel: vi.fn(async () => false),
    postReview: vi.fn(async () => 'https://example.test/review'),
    addApprovalLabel: vi.fn(async () => undefined),
    removeApprovalLabel: vi.fn(async () => undefined),
    ...overrides,
  }
}

function input(severity?: 'blocking' | 'high' | 'low'): ReviewInput {
  return {
    effort: 'high',
    summary: '',
    skipped: [],
    questions: [],
    findings:
      severity === undefined
        ? []
        : [{ pillar: 'rules', severity, title: 'T', body: 'B', path: 'a.ts', line: 1 }],
  }
}

describe('revokeFinalApproval', () => {
  it('removes the label only when present', async () => {
    const absent = fakeIo()
    await expect(revokeFinalApproval(absent)).resolves.toBe(false)
    expect(absent.removeApprovalLabel).not.toHaveBeenCalled()
    const present = fakeIo({ hasApprovalLabel: vi.fn(async () => true) })
    await expect(revokeFinalApproval(present)).resolves.toBe(true)
    expect(present.removeApprovalLabel).toHaveBeenCalledOnce()
  })
})

describe('postFinalReview', () => {
  it('rejects malformed SHAs and a moved head', async () => {
    await expect(postFinalReview(fakeIo(), input(), 'ABC')).rejects.toThrow(ReviewError)
    await expect(postFinalReview(fakeIo(), input(), OTHER)).rejects.toThrow(
      /re-review the new head/u,
    )
  })

  it('dry runs without posting', async () => {
    const io = fakeIo()
    const outcome = await postFinalReview(io, input('high'), SHA, { dryRun: true })
    expect(outcome).toMatchObject({ verdict: 'Comment', urls: [], label: 'unchanged' })
    expect(outcome.reviews).toHaveLength(1)
    expect(io.postReview).not.toHaveBeenCalled()
  })

  it('posts and labels an approval', async () => {
    const io = fakeIo()
    const outcome = await postFinalReview(io, input('low'), SHA)
    expect(outcome).toMatchObject({
      verdict: 'Approve',
      urls: ['https://example.test/review'],
      label: 'added',
    })
    expect(io.addApprovalLabel).toHaveBeenCalledOnce()
  })

  it('posts a non-approval, removing a stale label when present', async () => {
    const stale = fakeIo({ hasApprovalLabel: vi.fn(async () => true) })
    await expect(postFinalReview(stale, input('blocking'), SHA)).resolves.toMatchObject({
      verdict: 'Request Changes',
      label: 'removed',
    })
    const clean = fakeIo()
    await expect(postFinalReview(clean, input('high'), SHA)).resolves.toMatchObject({
      label: 'unchanged',
    })
    expect(clean.addApprovalLabel).not.toHaveBeenCalled()
  })
})

describe('postFinalReview event', () => {
  it('posts the verdict as its own event, on the first part only', async () => {
    const approve = fakeIo()
    await expect(postFinalReview(approve, input('low'), SHA)).resolves.toMatchObject({
      event: 'APPROVE',
    })
    expect(approve.postReview.mock.calls[0]?.[0].event).toBe('APPROVE')
    const changes = fakeIo()
    await postFinalReview(changes, input('blocking'), SHA)
    expect(changes.postReview.mock.calls[0]?.[0].event).toBe('REQUEST_CHANGES')
    const comment = fakeIo()
    const outcome = await postFinalReview(comment, input('high'), SHA)
    expect(outcome).toMatchObject({ event: 'COMMENT' })
    expect(outcome.downgraded).toBeUndefined()
    expect(comment.pullAuthor).not.toHaveBeenCalled()
    const many = fakeIo()
    const wide = { ...input('low'), findings: input('low').findings.concat(input('low').findings) }
    await postFinalReview(many, wide, SHA, {
      limits: { maxComments: 1, maxBodyChars: 100_000 },
    })
    expect(many.postReview.mock.calls.map(([review]) => review.event)).toEqual([
      'APPROVE',
      'COMMENT',
    ])
  })

  it("posts a COMMENT on the reviewer's own pull request, and says so", async () => {
    const io = fakeIo({ pullAuthor: vi.fn(async () => 'Bot[bot]') })
    const outcome = await postFinalReview(io, input('low'), SHA)
    expect(outcome).toMatchObject({
      verdict: 'Approve',
      event: 'COMMENT',
      downgraded: 'self-review',
      label: 'added',
    })
    expect(io.postReview.mock.calls[0]?.[0].event).toBe('COMMENT')
  })

  it('posts a COMMENT when the identity cannot be determined', async () => {
    const unknown = fakeIo({ trustedAuthors: vi.fn(async () => new Set<string>()) })
    await expect(postFinalReview(unknown, input('blocking'), SHA)).resolves.toMatchObject({
      event: 'COMMENT',
      downgraded: 'identity-unknown',
    })
    const noAuthor = fakeIo({ pullAuthor: vi.fn(async () => undefined) })
    await expect(postFinalReview(noAuthor, input('low'), SHA)).resolves.toMatchObject({
      downgraded: 'identity-unknown',
    })
    const failed = fakeIo({
      pullAuthor: vi.fn(async () => {
        throw new Error('network')
      }),
    })
    await expect(postFinalReview(failed, input('low'), SHA)).resolves.toMatchObject({
      downgraded: 'identity-unknown',
    })
  })

  it('retries once as a COMMENT when GitHub rejects the event, and reports it', async () => {
    const postReview = vi
      .fn<ReviewIo['postReview']>()
      .mockRejectedValueOnce(new ReviewRejectedError('no', { cause: 'x' }))
      .mockResolvedValueOnce('https://example.test/second')
    const io = fakeIo({ postReview })
    const outcome = await postFinalReview(io, input('blocking'), SHA)
    expect(outcome).toMatchObject({
      event: 'COMMENT',
      downgraded: 'rejected',
      urls: ['https://example.test/second'],
    })
    expect(postReview.mock.calls.map(([review]) => review.event)).toEqual([
      'REQUEST_CHANGES',
      'COMMENT',
    ])
  })

  it('does not retry other failures, or a rejected COMMENT', async () => {
    const broken = fakeIo({ postReview: vi.fn(async () => Promise.reject(new Error('boom'))) })
    await expect(postFinalReview(broken, input('low'), SHA)).rejects.toThrow('boom')
    expect(broken.postReview).toHaveBeenCalledOnce()
    const rejected = fakeIo({
      postReview: vi.fn(async () => Promise.reject(new ReviewRejectedError('no', { cause: 1 }))),
    })
    await expect(postFinalReview(rejected, input('high'), SHA)).rejects.toThrow(ReviewRejectedError)
    expect(rejected.postReview).toHaveBeenCalledOnce()
  })

  it('reports the event on a dry run without posting', async () => {
    const io = fakeIo()
    await expect(postFinalReview(io, input('low'), SHA, { dryRun: true })).resolves.toMatchObject({
      event: 'APPROVE',
      urls: [],
    })
    expect(io.postReview).not.toHaveBeenCalled()
  })

  it('posts nothing for a review with no parts', async () => {
    await expect(postReviews(fakeIo(), [])).resolves.toEqual({ urls: [], event: 'COMMENT' })
  })
})

describe('postFinalReview posted text', () => {
  const wordy = (body: string): ReviewInput => ({
    ...input('low'),
    findings: [{ pillar: 'rules', severity: 'low', title: 'T', body, path: 'a.ts', line: 1 }],
  })

  it('warns about long and narrating text without refusing', async () => {
    const io = fakeIo()
    const long = { ...wordy('The verifier confirmed it. ' + 'x'.repeat(900)), summary: '' }
    const outcome = await postFinalReview(io, long, SHA)
    expect(outcome.warnings).toEqual([
      expect.stringContaining('inline comment on a.ts:1 is'),
      expect.stringContaining('findings[0].body narrates the review'),
    ])
    expect(outcome.tooLong).toEqual([])
    expect(io.postReview).toHaveBeenCalledOnce()
  })

  it('refuses text over three times a target before posting, unless allowed', async () => {
    const io = fakeIo()
    const huge = wordy('x'.repeat(2500))
    await expect(postFinalReview(io, huge, SHA)).rejects.toThrow(/allow-long/u)
    expect(io.postReview).not.toHaveBeenCalled()
    const allowed = await postFinalReview(io, huge, SHA, { allowLong: true })
    expect(allowed.tooLong).toHaveLength(1)
    expect(io.postReview).toHaveBeenCalledOnce()
  })

  it('reports, but does not refuse, text over three times a target on a dry run', async () => {
    const io = fakeIo()
    const outcome = await postFinalReview(io, wordy('x'.repeat(2500)), SHA, { dryRun: true })
    expect(outcome.tooLong).toHaveLength(1)
    const custom = await postFinalReview(io, wordy('x'.repeat(50)), SHA, {
      dryRun: true,
      textLimits: { bodyTarget: 1200, inlineTarget: 10 },
    })
    expect(custom.warnings).toHaveLength(1)
  })
})

describe('reviewStatus', () => {
  const body = (sha: string, verdict: Verdict) => reviewMarker(sha, verdict, 'high')

  it('reports no review when none carries a marker', async () => {
    const io = fakeIo({ listReviews: vi.fn(async () => asReviews(['LGTM', 'plain'])) })
    await expect(reviewStatus(io)).resolves.toEqual({
      headSha: SHA,
      reviewedSha: null,
      verdict: null,
      effort: null,
      current: false,
      labeled: false,
      approved: false,
      skipped: false,
    })
  })

  it('approves only for the newest marker on the current head with the label', async () => {
    const approved = fakeIo({
      listReviews: vi.fn(async () =>
        asReviews([body(OTHER, 'Request Changes'), `x\n${body(SHA, 'Approve')}`]),
      ),
      hasApprovalLabel: vi.fn(async () => true),
    })
    await expect(reviewStatus(approved)).resolves.toMatchObject({
      reviewedSha: SHA,
      verdict: 'Approve',
      effort: 'high',
      current: true,
      labeled: true,
      approved: true,
    })
    const stale = fakeIo({
      listReviews: vi.fn(async () => asReviews([body(OTHER, 'Approve')])),
      hasApprovalLabel: vi.fn(async () => true),
    })
    await expect(reviewStatus(stale)).resolves.toMatchObject({
      current: false,
      approved: false,
    })
    const forged = fakeIo({
      listReviews: vi.fn(async () => [
        ...asReviews([body(OTHER, 'Request Changes')]),
        ...asReviews([body(SHA, 'Approve')], 'mallory'),
        { body: body(SHA, 'Approve'), author: null },
      ]),
      hasApprovalLabel: vi.fn(async () => true),
    })
    await expect(reviewStatus(forged)).resolves.toMatchObject({
      reviewedSha: OTHER,
      approved: false,
    })
    const unlabeled = fakeIo({ listReviews: vi.fn(async () => asReviews([body(SHA, 'Approve')])) })
    await expect(reviewStatus(unlabeled)).resolves.toMatchObject({ approved: false })
    const commented = fakeIo({
      listReviews: vi.fn(async () => asReviews([body(SHA, 'Comment')])),
      hasApprovalLabel: vi.fn(async () => true),
    })
    await expect(reviewStatus(commented)).resolves.toMatchObject({ approved: false })
  })

  it('treats a skip notice on the current head as skipped, never approved', async () => {
    const notice = `**Code review skipped:** lockfile\n\n${reviewMarker(SHA, 'Skipped', 'low')}`
    const skipped = fakeIo({
      listReviews: vi.fn(async () => asReviews([body(SHA, 'Approve'), notice])),
      hasApprovalLabel: vi.fn(async () => true),
    })
    await expect(reviewStatus(skipped)).resolves.toMatchObject({
      verdict: 'Skipped',
      effort: 'low',
      current: true,
      approved: false,
      skipped: true,
    })
    const stale = fakeIo({
      listReviews: vi.fn(async () => asReviews([reviewMarker(OTHER, 'Skipped', 'low')])),
    })
    await expect(reviewStatus(stale)).resolves.toMatchObject({ skipped: false })
    const forged = fakeIo({
      listReviews: vi.fn(async () => asReviews([notice], 'mallory')),
    })
    await expect(reviewStatus(forged)).resolves.toMatchObject({ skipped: false })
    const superseded = fakeIo({
      listReviews: vi.fn(async () => asReviews([notice, body(SHA, 'Request Changes')])),
    })
    await expect(reviewStatus(superseded)).resolves.toMatchObject({ skipped: false })
  })
})

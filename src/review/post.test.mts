import { describe, expect, it, vi, type Mock } from 'vitest'

import { ReviewError, type ReviewInput } from './finding.mts'
import type { ReviewIo } from './github.mts'
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

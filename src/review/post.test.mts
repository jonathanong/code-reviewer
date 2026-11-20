import { describe, expect, it, vi, type Mock } from 'vitest'

import { ReviewError, type ReviewInput } from './finding.mts'
import { ReviewRejectedError, type ListedReview, type ReviewIo } from './github.mts'
import { postReviews } from './submit.mts'
import { reviewStatus, postFinalReview, revokeFinalApproval } from './post.mts'
import { reviewMarker, type Verdict } from './render.mts'

const SHA = 'c'.repeat(40)
const OTHER = 'd'.repeat(40)

const asReviews = (bodies: string[], author: string | null = 'bot'): ListedReview[] =>
  bodies.map((body, at) => ({ id: at + 1, url: `https://example.test/r/${at + 1}`, body, author }))

type MockIo = { [K in keyof ReviewIo]: Mock<ReviewIo[K]> }

/** A pull request that keeps what is posted to it, so the read-back finds it. */
function fakeIo(overrides: Partial<MockIo> = {}): MockIo {
  const posted: ListedReview[] = []
  return {
    headSha: vi.fn(async () => SHA),
    diff: vi.fn(async () => ''),
    listFiles: vi.fn(async () => [{ filename: 'a.ts', patch: '@@ -1 +1 @@\n+x\n' }]),
    listReviews: vi.fn(async () => [...posted]),
    trustedAuthors: vi.fn(async () => new Set(['bot'])),
    pullAuthor: vi.fn(async () => 'dev'),
    changesRequested: vi.fn(async () => []),
    dismissReview: vi.fn(async () => undefined),
    hasApprovalLabel: vi.fn(async () => false),
    postReview: vi.fn(async (review) => {
      const id = 100 + posted.length
      const url = `https://example.test/review/${id}`
      posted.push({ id, url, body: review.body, author: 'bot' })
      return url
    }),
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
      urls: ['https://example.test/review/100'],
      reviewIds: [100],
      confirmed: true,
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
    const io = fakeIo()
    const { postReview } = io
    postReview.mockRejectedValueOnce(new ReviewRejectedError('no', { cause: 'x' }))
    const outcome = await postFinalReview(io, input('blocking'), SHA)
    expect(outcome).toMatchObject({
      event: 'COMMENT',
      downgraded: 'rejected',
      urls: ['https://example.test/review/100'],
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
    expect(io.listReviews).not.toHaveBeenCalled()
  })

  it('reports the confirmed review ids, and warns instead of claiming a confirmation it lacks', async () => {
    const io = fakeIo()
    await expect(postFinalReview(io, input('low'), SHA)).resolves.toMatchObject({
      reviewIds: [100],
      confirmed: true,
      warnings: [],
    })
    const blind = fakeIo({ trustedAuthors: vi.fn(async () => new Set<string>()) })
    const outcome = await postFinalReview(blind, input('low'), SHA)
    expect(outcome).toMatchObject({ reviewIds: [], confirmed: false, label: 'added' })
    expect(outcome.warnings).toEqual([
      expect.stringContaining('could not be confirmed'),
      expect.stringContaining('was not dismissed'),
    ])
  })

  it('does not label a review that is not on the pull request', async () => {
    const io = fakeIo({ postReview: vi.fn(async () => 'https://example.test/phantom') })
    await expect(postFinalReview(io, input('low'), SHA)).rejects.toThrow(ReviewError)
    expect(io.addApprovalLabel).not.toHaveBeenCalled()
  })

  it('posts nothing for a review with no parts', async () => {
    await expect(postReviews(fakeIo(), [])).resolves.toEqual({
      urls: [],
      event: 'COMMENT',
      confirmed: [],
      warnings: [],
    })
  })
})

describe('postFinalReview earlier requests for changes', () => {
  const MARK = `<!-- final-review sha=${'a'.repeat(40)} verdict=Request-Changes effort=low -->`
  const standing = (extra: Partial<MockIo> = {}) =>
    fakeIo({
      changesRequested: vi.fn(async () => [
        { id: 11, author: 'bot', body: `${MARK}\n\nOld` },
        { id: 12, author: 'eve', body: `${MARK}\n\nForged` },
        { id: 13, author: 'bot', body: 'unmarked' },
      ]),
      ...extra,
    })

  it('dismisses only its own marked request for changes after a COMMENT, once posted', async () => {
    const io = standing()
    const outcome = await postFinalReview(io, input('high'), SHA)
    expect(outcome).toMatchObject({ event: 'COMMENT', dismissed: [11] })
    expect(io.dismissReview).toHaveBeenCalledOnce()
    expect(io.dismissReview).toHaveBeenCalledWith(
      11,
      expect.stringContaining('https://example.test/r'),
    )
    expect(io.postReview.mock.invocationCallOrder[0]).toBeLessThan(
      io.dismissReview.mock.invocationCallOrder[0] as number,
    )
  })

  it('dismisses nothing when the post fails, so the old block is never cleared without a new review', async () => {
    const io = standing({
      postReview: vi.fn(async () => {
        throw new Error('HTTP 401: Bad credentials')
      }),
    })
    await expect(postFinalReview(io, input('high'), SHA)).rejects.toThrow('HTTP 401')
    expect(io.changesRequested).not.toHaveBeenCalled()
    expect(io.dismissReview).not.toHaveBeenCalled()
  })

  it('dismisses nothing when the new review cannot be confirmed, and says so', async () => {
    const io = standing({ trustedAuthors: vi.fn(async () => new Set<string>()) })
    const outcome = await postFinalReview(io, input('high'), SHA)
    expect(outcome).toMatchObject({ confirmed: false, dismissed: [] })
    expect(io.dismissReview).not.toHaveBeenCalled()
    expect(outcome.warnings).toContain(
      'An earlier request for changes was not dismissed because the new review was not confirmed.',
    )
  })

  it('leaves it alone for APPROVE and REQUEST_CHANGES, and when the verdict still requests changes', async () => {
    for (const severity of ['low', 'blocking'] as const) {
      const io = standing()
      await expect(postFinalReview(io, input(severity), SHA)).resolves.toMatchObject({
        dismissed: [],
      })
      expect(io.changesRequested).not.toHaveBeenCalled()
    }
    const unknown = standing({ trustedAuthors: vi.fn(async () => new Set<string>()) })
    const outcome = await postFinalReview(unknown, input('blocking'), SHA)
    expect(outcome).toMatchObject({ downgraded: 'identity-unknown', dismissed: [] })
    expect(unknown.changesRequested).not.toHaveBeenCalled()
  })

  it('does not fail the post when a dismissal fails, and names the review left standing', async () => {
    const io = standing({
      dismissReview: vi.fn(async () => {
        throw new Error('403')
      }),
    })
    const outcome = await postFinalReview(io, input('high'), SHA)
    expect(outcome.dismissed).toEqual([])
    expect(outcome.warnings).toEqual([expect.stringContaining('Review 11 still requests changes')])
    expect(io.postReview).toHaveBeenCalledOnce()
  })

  it('says what it would dismiss on a dry run, and dismisses nothing', async () => {
    const io = standing()
    const outcome = await postFinalReview(io, input('high'), SHA, { dryRun: true })
    expect(outcome).toMatchObject({ dismissed: [], wouldDismiss: [11] })
    expect(io.dismissReview).not.toHaveBeenCalled()
    expect(io.postReview).not.toHaveBeenCalled()
    const approve = await postFinalReview(standing(), input('low'), SHA, { dryRun: true })
    expect(approve.wouldDismiss).toEqual([])
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
        ...asReviews([body(SHA, 'Approve')], null),
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

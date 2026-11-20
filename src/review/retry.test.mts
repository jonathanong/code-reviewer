import { describe, expect, it, vi } from 'vitest'

import type { ReviewInput } from './finding.mts'
import type { ReviewIo } from './github.mts'
import { abortReview, claimReview, completeReview, type LabelIo } from './labels.mts'
import { reviewStatus, postFinalReview } from './post.mts'
import { DEFAULT_LABELS } from './settings.mts'

const { requested: REQUESTED_LABEL, completed: COMPLETE_LABEL } = DEFAULT_LABELS

const SHA = 'c'.repeat(40)

function labelIo(initial: string[]): LabelIo {
  const set = new Set(initial)
  return {
    labels: async () => [...set],
    add: async (names) => {
      for (const name of names) set.add(name)
    },
    remove: async (name) => {
      set.delete(name)
    },
  }
}

const input: ReviewInput = {
  effort: 'high',
  summary: '',
  skipped: [],
  questions: [],
  findings: ['a', 'b'].map((title, line) => ({
    pillar: 'rules',
    severity: 'low' as const,
    title,
    body: 'B',
    path: 'a.ts',
    line: line + 1,
  })),
}

describe('retry after a partial post', () => {
  it('claims the requeued retry and finishes publication', async () => {
    const reviews: string[] = []
    let failSecond = true
    const io: ReviewIo = {
      headSha: async () => SHA,
      diff: async () => '',
      listFiles: async () => [{ filename: 'a.ts', patch: '@@ -0,0 +1,2 @@\n+x\n+y\n' }],
      listReviews: async () => reviews.map((body) => ({ body, author: 'bot' })),
      trustedAuthors: async () => new Set(['bot']),
      pullAuthor: async () => 'dev',
      hasApprovalLabel: async () => false,
      postReview: vi.fn(async (review) => {
        if (reviews.length === 1 && failSecond) throw new Error('boom')
        reviews.push(review.body)
        return 'url'
      }),
      addApprovalLabel: async () => undefined,
      removeApprovalLabel: async () => undefined,
    }
    const labels = labelIo([REQUESTED_LABEL])
    const limits = { maxComments: 1, maxBodyChars: 60_000 }

    await claimReview(labels, DEFAULT_LABELS, { headReviewed: false })
    await expect(postFinalReview(io, input, SHA, { limits })).rejects.toThrow('boom')
    await abortReview(labels, DEFAULT_LABELS, { requeue: true })

    // The first part carries the marker, so the head already looks reviewed.
    const status = await reviewStatus(io)
    expect(status.current).toBe(true)

    const retry = await claimReview(labels, DEFAULT_LABELS, { headReviewed: status.current })
    expect(retry).toMatchObject({ claimed: true })

    failSecond = false
    reviews.length = 0
    await postFinalReview(io, input, SHA, { limits })
    expect(reviews).toHaveLength(2)
    await completeReview(labels, DEFAULT_LABELS)
    expect(await labels.labels()).toEqual([COMPLETE_LABEL])

    const again = labelIo([COMPLETE_LABEL, REQUESTED_LABEL])
    await expect(claimReview(again, DEFAULT_LABELS, { headReviewed: true })).resolves.toMatchObject(
      {
        claimed: false,
      },
    )
  })
})

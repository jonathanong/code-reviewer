import { vi, type Mock } from 'vitest'

import type { ReviewInput } from './finding.mts'
import type { ListedReview, ReviewIo } from './github.mts'

export const SHA = 'c'.repeat(40)

export type MockIo = { [K in keyof ReviewIo]: Mock<ReviewIo[K]> }

/** A pull request that keeps what is posted to it, so the read-back finds it. */
export function fakeIo(overrides: Partial<MockIo> = {}): MockIo {
  const posted: ListedReview[] = []
  return {
    headSha: vi.fn(async () => SHA),
    diff: vi.fn(async () => ''),
    listFiles: vi.fn(async () => [{ filename: 'a.ts', patch: '@@ -1 +1 @@\n+x\n' }]),
    listReviews: vi.fn(async () => [...posted]),
    trustedAuthors: vi.fn(async () => new Set(['bot'])),
    pullAuthor: vi.fn(async () => 'dev'),
    standingReviews: vi.fn(async () => []),
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

export function input(severity?: 'blocking' | 'high' | 'low'): ReviewInput {
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

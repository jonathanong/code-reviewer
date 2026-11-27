import { describe, expect, it } from 'vitest'

import type { PrConversation, PrReview, ThreadComment } from './context-query.mts'
import { buildFollowUpContext } from './context.mts'
import { reviewMarker } from './render.mts'

const A = 'a'.repeat(40)
const FINDING = '**[high · correctness]** Title here\n\nbody'

function comment(overrides: Partial<ThreadComment> = {}): ThreadComment {
  return {
    author: { login: 'alice' },
    body: 'note',
    createdAt: 't',
    pullRequestReview: null,
    ...overrides,
  }
}

const marked: PrReview = {
  id: 'F',
  author: { login: 'bot' },
  state: 'COMMENTED',
  body: reviewMarker(A, 'Comment', 'low'),
  submittedAt: null,
  commit: { oid: A },
}

function pull(overrides: Partial<PrConversation> = {}): PrConversation {
  return {
    title: 'Title',
    author: { login: 'dev', __typename: 'User' },
    body: '',
    closingIssuesReferences: { nodes: [] },
    headRefOid: A,
    baseRefOid: A,
    baseRefName: 'main',
    additions: 1,
    deletions: 1,
    reviews: { nodes: [marked] },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
    commits: { nodes: [{ commit: { oid: A, messageHeadline: 'c' } }] },
    ...overrides,
  }
}

describe('replies on a finding thread', () => {
  it("are carried without this reviewer's own, bounded and cut", () => {
    const first = comment({
      body: FINDING,
      pullRequestReview: { id: 'F' },
      author: { login: 'bot' },
    })
    const replies = [
      comment({ author: { login: 'bot' }, body: 'our own follow-up' }),
      comment({ author: { login: 'carol' }, body: `pre-1.0 <!-- x --> ${'z'.repeat(400)}` }),
      comment({ author: null, body: 'two' }),
      ...Array.from({ length: 5 }, () => comment({ body: 'more' })),
    ]
    const ctx = buildFollowUpContext(
      pull({
        reviewThreads: {
          nodes: [
            {
              id: 'T1',
              isResolved: false,
              isOutdated: false,
              path: 'a.ts',
              line: 3,
              comments: { totalCount: 12, nodes: [first, ...replies] },
            },
          ],
        },
      }),
      new Set(['bot']),
    )
    const [found] = ctx.unresolved
    expect(found?.replies).toHaveLength(5)
    expect(found?.replies?.[0]).toEqual({
      login: 'carol',
      text: `pre-1.0 ${'z'.repeat(292)} [cut]`,
    })
    expect(found?.replies?.[1]).toEqual({ login: 'unknown author', text: 'two' })
    // 12 comments: the finding, one of ours, five shown, so five are not.
    expect(found?.moreReplies).toBe(5)
  })
})

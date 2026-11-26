import { describe, expect, it } from 'vitest'

import type { PrConversation, PrReview } from './context-query.mts'
import { buildFollowUpContext } from './context.mts'
import { reviewMarker } from './render.mts'

const sha = (c: string) => c.repeat(40)
const [A, B, C] = [sha('a'), sha('b'), sha('c')]
const more = { hasPreviousPage: true }
const none = { hasPreviousPage: false }

function review(overrides: Partial<PrReview> = {}): PrReview {
  return {
    id: 'R1',
    author: { login: 'bot' },
    state: 'COMMENTED',
    body: '',
    submittedAt: null,
    commit: { oid: A },
    ...overrides,
  }
}

function pull(overrides: Partial<PrConversation> = {}): PrConversation {
  return {
    title: 'Title',
    author: { login: 'dev', __typename: 'User' },
    body: 'Does a thing.',
    closingIssuesReferences: { nodes: [] },
    headRefOid: C,
    baseRefOid: B,
    baseRefName: 'main',
    additions: 5,
    deletions: 2,
    reviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
    commits: { nodes: [A, B, C].map((oid) => ({ commit: { oid, messageHeadline: 'c' } })) },
    ...overrides,
  }
}

const build = (p: PrConversation) => buildFollowUpContext(p, new Set(['bot']))

describe('what the conversation read left out', () => {
  it('reads nothing unread from a conversation that fit', () => {
    const ctx = build(pull({ reviews: { nodes: [], pageInfo: none } }))
    expect(ctx.unread).toEqual({ threads: 0, ownReview: false })
    expect(ctx.olderSkipped).toBe(false)
  })

  it('only notes older resolved history, without counting it as unread', () => {
    const ctx = build(
      pull({
        reviews: { nodes: [review({ body: reviewMarker(A, 'Approve', 'low') })], pageInfo: more },
        reviewThreads: { nodes: [], pageInfo: none, unread: 0 },
        olderSkipped: true,
      }),
    )
    expect(ctx.unread).toEqual({ threads: 0, ownReview: false })
    expect(ctx.olderSkipped).toBe(true)
  })

  it('counts older threads the walk did not reach', () => {
    const ctx = build(pull({ reviewThreads: { nodes: [], pageInfo: more, unread: 42 } }))
    expect(ctx.unread.threads).toBe(42)
  })

  it('flags a missing own review only when older reviews exist', () => {
    expect(build(pull({ reviews: { nodes: [], pageInfo: more } })).unread.ownReview).toBe(true)
    expect(build(pull({ reviews: { nodes: [], pageInfo: none } })).unread.ownReview).toBe(false)
    const skipped = review({ body: reviewMarker(A, 'Skipped', 'low') })
    expect(build(pull({ reviews: { nodes: [skipped], pageInfo: more } })).unread.ownReview).toBe(
      true,
    )
  })

  it('does not flag when this reviewer’s review is among those read', () => {
    const own = review({ body: reviewMarker(A, 'Approve', 'low') })
    expect(build(pull({ reviews: { nodes: [own], pageInfo: more } })).unread.ownReview).toBe(false)
  })
})

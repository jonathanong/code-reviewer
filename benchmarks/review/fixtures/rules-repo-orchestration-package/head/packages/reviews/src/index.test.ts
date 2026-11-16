import { describe, expect, it, vi } from 'vitest'

import { createReviewsEngine, type ReviewsHooks } from './index.ts'

function hooks(overrides: Partial<ReviewsHooks<object>> = {}): ReviewsHooks<object> {
  return {
    transaction: (work) => work({}),
    lockTarget: async () => ({ ownerId: 'owner', closed: false }),
    canReview: async () => true,
    findReview: async () => null,
    insertReview: async () => 'r1',
    notifyOwner: async () => undefined,
    ...overrides,
  }
}

const input = { targetId: 't1', authorId: 'author', rating: 5, body: 'Great' }

describe('createReviewsEngine', () => {
  it('publishes a review and notifies the owner', async () => {
    const notifyOwner = vi.fn(async () => undefined)
    await expect(createReviewsEngine(hooks({ notifyOwner })).submit(input)).resolves.toEqual({
      status: 'published',
      id: 'r1',
    })
    expect(notifyOwner).toHaveBeenCalledWith('owner', 'r1')
  })

  it('holds a low rating for moderation without notifying', async () => {
    const notifyOwner = vi.fn(async () => undefined)
    const engine = createReviewsEngine(hooks({ notifyOwner }))
    await expect(engine.submit({ ...input, rating: 2 })).resolves.toEqual({
      status: 'pending',
      id: 'r1',
    })
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('refuses a review of your own target, a duplicate, and a closed target', async () => {
    const own = hooks({ lockTarget: async () => ({ ownerId: 'author', closed: false }) })
    await expect(createReviewsEngine(own).submit(input)).resolves.toEqual({ status: 'own_target' })
    const duplicate = hooks({ findReview: async () => ({ id: 'r0' }) })
    await expect(createReviewsEngine(duplicate).submit(input)).resolves.toEqual({
      status: 'duplicate',
    })
    const closed = hooks({ lockTarget: async () => ({ ownerId: 'owner', closed: true }) })
    await expect(createReviewsEngine(closed).submit(input)).resolves.toEqual({ status: 'closed' })
  })
})

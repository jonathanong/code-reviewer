export type ReviewInput = { targetId: string; authorId: string; rating: number; body: string }

export type ReviewsHooks<Tx> = {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>
  lockTarget(tx: Tx, targetId: string): Promise<{ ownerId: string; closed: boolean } | null>
  canReview(tx: Tx, authorId: string, targetId: string): Promise<boolean>
  findReview(tx: Tx, authorId: string, targetId: string): Promise<{ id: string } | null>
  insertReview(tx: Tx, input: ReviewInput, status: 'published' | 'pending'): Promise<string>
  notifyOwner(ownerId: string, reviewId: string): Promise<void>
}

export type SubmitResult =
  | { status: 'published' | 'pending'; id: string }
  | { status: 'not_found' | 'closed' | 'forbidden' | 'own_target' | 'duplicate' | 'invalid_rating' }

/** Builds the review submission flow on the hooks an application provides. */
export function createReviewsEngine<Tx>(hooks: ReviewsHooks<Tx>) {
  return {
    async submit(input: ReviewInput): Promise<SubmitResult> {
      if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
        return { status: 'invalid_rating' }
      const result = await hooks.transaction(async (tx) => {
        const target = await hooks.lockTarget(tx, input.targetId)
        if (target === null) return { status: 'not_found' as const }
        if (target.closed) return { status: 'closed' as const }
        if (target.ownerId === input.authorId) return { status: 'own_target' as const }
        if (!(await hooks.canReview(tx, input.authorId, input.targetId)))
          return { status: 'forbidden' as const }
        if ((await hooks.findReview(tx, input.authorId, input.targetId)) !== null)
          return { status: 'duplicate' as const }
        // One- and two-star reviews wait for moderation.
        const status = input.rating <= 2 ? ('pending' as const) : ('published' as const)
        const id = await hooks.insertReview(tx, input, status)
        return { status, id, ownerId: target.ownerId }
      })
      if (!('id' in result)) return result
      if (result.status === 'published') await hooks.notifyOwner(result.ownerId, result.id)
      return { status: result.status, id: result.id }
    },
  }
}

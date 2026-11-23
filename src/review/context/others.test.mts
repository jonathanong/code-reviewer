import { describe, expect, it } from 'vitest'

import type { PrConversation } from '../context-query.mts'
import { othersFrom } from './others.mts'

const TRUSTED = new Set(['reviewer-app'])

function pull(parts: Partial<PrConversation>): PrConversation {
  return {
    reviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
    ...parts,
  } as PrConversation
}

const note = (login: string, body: string, extra: object = {}) => ({
  author: { login, __typename: 'User' },
  body,
  createdAt: '2025-01-01',
  ...extra,
})

describe('othersFrom', () => {
  it('drops this reviewer’s own notes of every kind, marker or not', () => {
    const own = { login: 'Reviewer-App[bot]', __typename: 'Bot' }
    const result = othersFrom(
      pull({
        reviews: {
          nodes: [
            { id: 'R', state: 'COMMENTED', body: 'own summary', submittedAt: '1', author: own },
          ],
        } as unknown as PrConversation['reviews'],
        reviewThreads: {
          nodes: [
            {
              id: 'T',
              isResolved: false,
              isOutdated: false,
              path: 'a.ts',
              line: 1,
              comments: { nodes: [{ ...note('x', 'own thread'), author: own }] },
            },
          ],
        } as unknown as PrConversation['reviewThreads'],
        comments: { nodes: [{ ...note('x', 'own comment'), author: own }] },
      }),
      new Set(),
      TRUSTED,
    )
    expect(result).toEqual({ notes: [], dropped: 0 })
  })

  it('drops minimized notes of every kind', () => {
    const result = othersFrom(
      pull({
        reviews: {
          nodes: [
            {
              id: 'R',
              state: 'COMMENTED',
              body: 'hidden summary',
              isMinimized: true,
              submittedAt: '1',
              author: { login: 'bob' },
              commit: null,
            },
          ],
        } as unknown as PrConversation['reviews'],
        reviewThreads: {
          nodes: [
            {
              id: 'T',
              isResolved: false,
              isOutdated: false,
              path: 'a.ts',
              line: 1,
              comments: { nodes: [note('bob', 'hidden thread', { isMinimized: true })] },
            },
          ],
        } as unknown as PrConversation['reviewThreads'],
        comments: { nodes: [note('bob', 'hidden comment', { isMinimized: true })] },
      }),
      new Set(),
      TRUSTED,
    )
    expect(result.notes).toEqual([])
  })

  it('labels bot authors and reports how many notes the cap dropped', () => {
    const nodes = Array.from({ length: 42 }, (_, i) => ({
      author: { login: 'robo', __typename: 'Bot' },
      body: `n${i}`,
      createdAt: `2025-01-${String(i + 1).padStart(2, '0')}`,
    }))
    const result = othersFrom(pull({ comments: { nodes } }), new Set(), TRUSTED)
    expect(result.dropped).toBe(2)
    expect(result.notes).toHaveLength(40)
    expect(result.notes[0]).toMatchObject({ text: 'n2', bot: true, kind: 'issue comment' })
  })
})

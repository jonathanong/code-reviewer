import { describe, expect, it } from 'vitest'

import type { PrConversation, ReviewThread, ThreadComment } from '../context-query.mts'
import { describeOthers } from './other-reviewers.mts'

const comment = (login: string | null, body: string): ThreadComment => ({
  url: 'https://example.test/c/1',
  author: login === null ? null : { login },
  body,
  createdAt: '2026-11-01T00:00:00Z',
  pullRequestReview: null,
})

const pull = (thread: Partial<ReviewThread> & Pick<ReviewThread, 'comments'>) =>
  ({
    reviewThreads: {
      nodes: [
        { id: 'PRT_1', isResolved: false, isOutdated: false, path: 'a.ts', line: 3, ...thread },
      ],
    },
    reviews: { nodes: [] },
  }) as unknown as PrConversation

const body = (thread: Parameters<typeof pull>[0]) =>
  describeOthers(pull(thread), new Set(['reviewer-app']))?.body ?? ''

describe('later comments of a thread in the Other reviewers section', () => {
  it('shows each later comment with its author, flattened and cut short', () => {
    const text = body({
      comments: {
        totalCount: 3,
        nodes: [
          comment('codex[bot]', 'Add a lock.'),
          comment('alice', 'We need\nthis one.'),
          comment(null, `${'z'.repeat(300)}`),
        ],
      },
    })
    expect(text).toContain('  - reply by alice: We need this one.')
    expect(text).toContain(`  - reply by unknown author: ${'z'.repeat(200)} [cut]`)
    expect(text.indexOf('Add a lock.')).toBeLessThan(text.indexOf('reply by alice'))
  })

  it('says how many comments were left out, from the shown count and the real size', () => {
    const nodes = [comment('codex[bot]', 'Add a lock.')].concat(
      Array.from({ length: 6 }, (_, at) => comment('alice', `reply ${at}`)),
    )
    const text = body({ comments: { totalCount: 30, nodes } })
    expect(text).toContain('reply 4')
    expect(text).not.toContain('reply 5')
    expect(text).toContain('  - [24 more comments not shown]')
  })

  it('adds nothing to a thread with one comment, or an unknown size', () => {
    expect(
      body({ comments: { totalCount: 1, nodes: [comment('codex[bot]', 'Add a lock.')] } }),
    ).not.toContain('reply by')
    expect(body({ comments: { nodes: [comment('codex[bot]', 'Add a lock.')] } })).not.toContain(
      'more comments',
    )
  })
})

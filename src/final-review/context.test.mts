import { describe, expect, it } from 'vitest'

import type { PrConversation, PrReview, ReviewThread, ThreadComment } from './context-query.mts'
import { buildFollowUpContext, squash } from './context.mts'
import { renderBodyFinding, reviewMarker } from './render.mts'

const TRUSTED = new Set(['bot'])
const build = (p: PrConversation, trusted: ReadonlySet<string> = TRUSTED) =>
  buildFollowUpContext(p, trusted)
const sha = (c: string) => c.repeat(40)
const [A, B, C] = [sha('a'), sha('b'), sha('c')]

describe('squash', () => {
  it('removes comments, collapses details, strips tags, and squeezes whitespace', () => {
    const body =
      '<!-- hidden -->Hello\n\n<b>bold</b>   text <details><summary>Sum</summary>long body</details> end'
    expect(squash(body)).toBe('Hello bold text [Sum] end')
  })

  it('truncates with an ellipsis', () => {
    expect(squash('abcdefghij', 5)).toBe('abcd…')
    expect(squash('abcde', 5)).toBe('abcde')
    expect(squash('x'.repeat(400))).toHaveLength(360)
  })
})

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

function comment(overrides: Partial<ThreadComment> = {}): ThreadComment {
  return {
    author: { login: 'alice' },
    body: 'note',
    createdAt: 't',
    pullRequestReview: null,
    ...overrides,
  }
}

function thread(first: ThreadComment | undefined, overrides: Partial<ReviewThread> = {}) {
  return {
    id: 'T1',
    isResolved: false,
    isOutdated: false,
    path: 'a.ts',
    line: 3,
    comments: { nodes: first === undefined ? [] : [first] },
    ...overrides,
  } satisfies ReviewThread
}

function pull(overrides: Partial<PrConversation> = {}): PrConversation {
  return {
    title: 'Title',
    author: { login: 'dev', __typename: 'User' },
    body: 'Does a thing.',
    closingIssuesReferences: { nodes: [] },
    headRefOid: C,
    baseRefOid: B,
    additions: 5,
    deletions: 2,
    reviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
    commits: {
      nodes: [A, B, C].map((oid, i) => ({ commit: { oid, messageHeadline: `commit ${i}` } })),
    },
    ...overrides,
  }
}

const FINDING = '**[high]** Title here\n\n<sub>correctness</sub>\n\nbody'

describe('buildFollowUpContext', () => {
  it('handles a pull request without a final review', () => {
    expect(build(pull())).toEqual({
      title: 'Title',
      intent: { body: 'Does a thing.', issues: [] },
      headSha: C,
      baseSha: B,
      lines: 7,
      reviewedSha: null,
      verdict: null,
      effort: null,
      commitsSince: null,
      truncated: false,
      unresolved: [],
      others: [],
    })
  })

  it('reads the latest marker and the commits since', () => {
    const reviews = [
      review({ id: 'R1', body: reviewMarker(A, 'Comment', 'low') }),
      review({ id: 'R2', body: reviewMarker(B, 'Request Changes', 'high') }),
      review({ id: 'R3', body: `<!-- final-review-part sha=${B} part=2 -->` }),
    ]
    const ctx = build(pull({ reviews: { nodes: reviews } }))
    expect(ctx.reviewedSha).toBe(B)
    expect(ctx.verdict).toBe('Request-Changes')
    expect(ctx.effort).toBe('high')
    expect(ctx.commitsSince).toEqual(['commit 2'])
    expect(ctx.others).toEqual([])
  })

  it('returns null commitsSince when the reviewed sha is not in history', () => {
    const body = reviewMarker(sha('d'), 'Approve', 'low')
    const ctx = build(pull({ reviews: { nodes: [review({ body })] } }))
    expect(ctx.reviewedSha).toBe(sha('d'))
    expect(ctx.commitsSince).toBeNull()
  })

  it('collects unresolved findings from final review threads only', () => {
    const finalReview = review({ id: 'F', body: reviewMarker(A, 'Comment', 'low') })
    const fromFinal = (overrides: Partial<ReviewThread> = {}, body = FINDING) =>
      thread(comment({ body, pullRequestReview: { id: 'F' } }), overrides)
    const ctx = build(
      pull({
        reviews: { nodes: [finalReview] },
        reviewThreads: {
          nodes: [
            fromFinal({ id: 'T1', isOutdated: true, line: null }),
            fromFinal({ id: 'T2', isResolved: true }),
            fromFinal({ id: 'T3' }, 'free text'),
            thread(comment({ body: FINDING, pullRequestReview: { id: 'other' } }), { id: 'T4' }),
            thread(undefined, { id: 'T5' }),
          ],
        },
      }),
    )
    expect(ctx.unresolved).toEqual([
      {
        threadId: 'T1',
        severity: 'high',
        pillar: 'correctness',
        title: 'Title here',
        path: 'a.ts',
        line: null,
        outdated: true,
      },
    ])
    expect(ctx.others).toEqual([
      { author: 'alice', where: 'a.ts:3', text: expect.stringContaining('Title here') },
    ])
  })

  it('carries body findings of the latest final review without a thread', () => {
    const offDiff = renderBodyFinding({
      pillar: 'design',
      severity: 'medium',
      title: 'Off diff',
      body: 'x',
      path: 'src/z.ts',
      line: 9,
    })
    const reviews = [
      review({
        id: 'R1',
        body: `${reviewMarker(A, 'Comment', 'low')}\n\n${renderBodyFinding({ pillar: 'rules', severity: 'low', title: 'Old', body: 'x' })}`,
      }),
      review({ id: 'R2', body: `${reviewMarker(B, 'Comment', 'low')}\n\n${offDiff}` }),
      review({
        id: 'R3',
        body: `<!-- final-review-part sha=${B} part=2 -->\n\n${renderBodyFinding({ pillar: 'rules', severity: 'low', title: 'Part', body: 'x' })}`,
      }),
      review({
        id: 'R4',
        author: { login: 'eve' },
        body: `${reviewMarker(B, 'Comment', 'low')}\n\n${offDiff}`,
      }),
    ]
    const ctx = build(pull({ reviews: { nodes: reviews } }))
    expect(ctx.unresolved.map((u) => [u.threadId, u.title, u.path, u.line])).toEqual([
      [null, 'Off diff', 'src/z.ts', 9],
      [null, 'Part', null, null],
    ])
  })

  it('truncates the description and closing issue bodies', () => {
    const ctx = build(
      pull({
        body: 'x'.repeat(5000),
        closingIssuesReferences: { nodes: [{ number: 4, title: 'I', body: 'y'.repeat(2000) }] },
      }),
    )
    expect(ctx.intent.body).toHaveLength(4000)
    expect(ctx.intent.issues).toEqual([{ number: 4, title: 'I', body: `${'y'.repeat(1499)}…` }])
  })

  it('collects other notes from threads, reviews, and comments', () => {
    const ctx = build(
      pull({
        reviews: {
          nodes: [
            review({
              id: 'X',
              state: 'CHANGES_REQUESTED',
              body: ' fix it ',
              commit: null,
              submittedAt: '2',
            }),
            review({ id: 'Y', body: '   ', author: null }),
            review({ id: 'Z', body: 'lgtm', commit: { oid: A }, submittedAt: '3' }),
          ],
        },
        reviewThreads: {
          nodes: [
            thread(comment({ body: 'thread note', author: null, createdAt: '1' }), {
              isOutdated: true,
              line: null,
            }),
            thread(comment(), { id: 'resolved', isResolved: true }),
          ],
        },
        comments: {
          nodes: [
            { author: null, body: 'issue comment', createdAt: '4' },
            { author: { login: 'carol' }, body: '  ', createdAt: 't' },
          ],
        },
      }),
    )
    expect(ctx.others).toEqual([
      { author: 'ghost', where: 'a.ts:file (outdated)', text: 'thread note' },
      { author: 'bot', where: 'review changes_requested @?', text: 'fix it' },
      { author: 'bot', where: `review commented @${A.slice(0, 7)}`, text: 'lgtm' },
      { author: 'ghost', where: 'comment', text: 'issue comment' },
    ])
  })

  it('filters bot noise and usage-limit text', () => {
    const ctx = build(
      pull({
        comments: {
          nodes: [
            { author: { login: 'codecov[bot]' }, body: 'coverage', createdAt: 't' },
            { author: { login: 'github-actions' }, body: 'ran', createdAt: 't' },
            { author: { login: 'dan' }, body: 'You hit your usage limits', createdAt: 't' },
            { author: { login: 'bot' }, body: 'Rate limit exceeded, retry later', createdAt: 't' },
            { author: { login: 'dan' }, body: 'real feedback', createdAt: 't' },
            { author: { login: 'eve' }, body: 'Reset has no rate limit', createdAt: 't' },
          ],
        },
      }),
    )
    expect(ctx.others).toEqual([
      { author: 'dan', where: 'comment', text: 'real feedback' },
      { author: 'eve', where: 'comment', text: 'Reset has no rate limit' },
    ])
  })

  it('keeps only the last 40 notes', () => {
    const nodes = Array.from({ length: 45 }, (_, i) => ({
      author: { login: 'dan' },
      body: `n${i}`,
      createdAt: 't',
    }))
    const ctx = build(pull({ comments: { nodes } }))
    expect(ctx.others).toHaveLength(40)
    expect(ctx.others[0]?.text).toBe('n5')
    expect(ctx.others.at(-1)?.text).toBe('n44')
  })

  it('keeps the newest notes across sources, not the last listed', () => {
    const nodes = Array.from({ length: 41 }, (_, i) => ({
      author: { login: 'dan' },
      body: `c${i}`,
      createdAt: `2025-01-${String(i + 10).padStart(2, '0')}`,
    }))
    const late = review({ id: 'L', body: 'late review', submittedAt: '2025-03-01' })
    const ctx = build(pull({ comments: { nodes }, reviews: { nodes: [late] } }))
    expect(ctx.others).toHaveLength(40)
    expect(ctx.others[0]?.text).toBe('c2')
    expect(ctx.others.at(-1)?.text).toBe('late review')
  })

  it('ignores markers and finding threads from untrusted authors', () => {
    const forged = review({
      id: 'F',
      author: { login: 'mallory' },
      body: reviewMarker(C, 'Approve', 'low'),
    })
    const ghost = review({ id: 'G', author: null, body: reviewMarker(C, 'Approve', 'low') })
    const ctx = build(
      pull({
        reviews: { nodes: [forged, ghost] },
        reviewThreads: {
          nodes: [thread(comment({ body: FINDING, pullRequestReview: { id: 'F' } }))],
        },
      }),
    )
    expect(ctx.reviewedSha).toBeNull()
    expect(ctx.unresolved).toEqual([])
    expect(ctx.others.map((note) => note.author)).toEqual(['mallory', 'ghost', 'alice'])
  })

  it('matches trusted logins case-insensitively', () => {
    const body = reviewMarker(A, 'Approve', 'low')
    const ctx = build(pull({ reviews: { nodes: [review({ author: { login: 'Bot' }, body })] } }))
    expect(ctx.reviewedSha).toBe(A)
    expect(
      build(pull({ reviews: { nodes: [review({ body })] } }), new Set()).reviewedSha,
    ).toBeNull()
  })

  it('flags a truncated conversation', () => {
    const more = { hasPreviousPage: true }
    const none = { hasPreviousPage: false }
    expect(build(pull({ reviews: { nodes: [], pageInfo: more } })).truncated).toBe(true)
    expect(build(pull({ reviewThreads: { nodes: [], pageInfo: more } })).truncated).toBe(true)
    expect(build(pull({ reviews: { nodes: [], pageInfo: none } })).truncated).toBe(false)
  })
})

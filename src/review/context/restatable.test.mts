import { describe, expect, it } from 'vitest'

import type { PrConversation, ReviewThread } from '../context-query.mts'
import { restatableThreads } from './restatable.mts'

const CODEX_HIGH = '![P1 Badge](https://img.example.test/p1.svg)\n\nCache is never invalidated.'
const CODEX_MEDIUM = '![P2 Badge](https://img.example.test/p2.svg)\n\nNaming drifts.'

function thread(login: string | null, body: string, over: Partial<ReviewThread> = {}) {
  return {
    id: 'T',
    isResolved: false,
    isOutdated: false,
    path: 'src/a.ts',
    line: 7,
    comments: {
      nodes: [
        {
          url: `https://example.test/c/${login ?? 'ghost'}`,
          author: login === null ? null : { login },
          body,
          createdAt: 't',
          pullRequestReview: null,
        },
      ],
    },
    ...over,
  } satisfies ReviewThread
}

const pull = (...nodes: ReviewThread[]) =>
  ({ reviewThreads: { nodes }, reviews: { nodes: [] } }) as unknown as PrConversation

const OWN = new Set(['reviewer-app'])

describe('restatableThreads', () => {
  it('keeps an open, current thread of another reviewer that states a high tier', () => {
    expect(restatableThreads(pull(thread('codex[bot]', CODEX_HIGH)), OWN)).toEqual([
      {
        login: 'codex[bot]',
        url: 'https://example.test/c/codex[bot]',
        where: 'src/a.ts:7',
        stated: 'P1 (Codex; high tier)',
        text: '![P1 Badge](https://img.example.test/p1.svg)\n\nCache is never invalidated.',
      },
    ])
  })

  it('keeps the blocking tier and a file-level thread without a line', () => {
    const body = '![P0 Badge](https://img.example.test/p0.svg) Data loss.'
    const items = restatableThreads(pull(thread('codex[bot]', body, { line: null })), OWN)
    expect(items).toMatchObject([{ where: 'src/a.ts', stated: 'P0 (Codex; blocking tier)' }])
  })

  it('leaves out medium, resolved, outdated, own, unstated, authorless and linkless threads', () => {
    const linkless = thread('bob', CODEX_HIGH)
    delete (linkless.comments.nodes[0] as { url?: string }).url
    const nodes = [
      thread('codex[bot]', CODEX_MEDIUM),
      thread('codex[bot]', CODEX_HIGH, { isResolved: true }),
      thread('codex[bot]', CODEX_HIGH, { isOutdated: true }),
      thread('reviewer-app', CODEX_HIGH),
      thread('alice', 'Please rename this.'),
      thread(null, CODEX_HIGH),
      thread('codex[bot]', CODEX_HIGH, { comments: { nodes: [] } }),
      linkless,
    ]
    expect(restatableThreads(pull(...nodes), OWN)).toEqual([])
  })

  it('cuts a long comment and caps the number of items', () => {
    const long = `${CODEX_HIGH}\n${'x'.repeat(600)}`
    const many = Array.from({ length: 14 }, () => thread('codex[bot]', long))
    const items = restatableThreads(pull(...many), OWN)
    expect(items).toHaveLength(10)
    expect(items[0]?.text.endsWith(' [cut]')).toBe(true)
  })
})

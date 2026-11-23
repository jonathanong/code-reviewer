import { describe, expect, it } from 'vitest'

import type { PrConversation, ReviewThread, ThreadComment } from '../context-query.mts'
import { answerableThreads, MAX_ANSWERABLE } from './answerable.mts'

const OWN = new Set(['reviewer-app'])

const comment = (login: string | null, body = 'Add a lock here.'): ThreadComment => ({
  url: 'https://example.test/c/1',
  author: login === null ? null : { login },
  body,
  createdAt: '2026-11-01T00:00:00Z',
  pullRequestReview: null,
})

const thread = (nodes: ThreadComment[], extra: Partial<ReviewThread> = {}): ReviewThread => ({
  id: 'PRT_1',
  isResolved: false,
  isOutdated: false,
  path: 'src/a.ts',
  line: 7,
  comments: { totalCount: nodes.length, nodes },
  ...extra,
})

const omitUrl = ({ url: _url, ...rest }: ThreadComment): ThreadComment => rest
const pull = (...threads: ReviewThread[]) =>
  ({ reviewThreads: { nodes: threads } }) as unknown as PrConversation

describe('answerableThreads', () => {
  it('lists an open note of another reviewer of any severity, with the later comments', () => {
    const items = answerableThreads(
      pull(thread([comment('codex[bot]'), comment('alice', 'x'.repeat(300))])),
      OWN,
    )
    expect(items).toEqual([
      {
        thread: 'PRT_1',
        login: 'codex[bot]',
        url: 'https://example.test/c/1',
        where: 'src/a.ts:7',
        text: 'Add a lock here.',
        replies: [{ login: 'alice', text: `${'x'.repeat(200)} [cut]` }],
      },
    ])
  })

  it('names a file-level thread by its path and a reply without an author', () => {
    const [item] = answerableThreads(
      pull(thread([comment('codex[bot]'), comment(null, 'ok')], { line: null })),
      OWN,
    )
    expect(item?.where).toBe('src/a.ts')
    expect(item?.replies).toEqual([{ login: 'unknown author', text: 'ok' }])
  })

  it('marks a first comment that was cut', () => {
    const [item] = answerableThreads(pull(thread([comment('codex[bot]', 'y'.repeat(900))])), OWN)
    expect(item?.text.endsWith(' [cut]')).toBe(true)
  })

  it.each([
    ['a resolved thread', thread([comment('codex[bot]')], { isResolved: true })],
    ['an outdated thread', thread([comment('codex[bot]')], { isOutdated: true })],
    ['an empty thread', thread([])],
    ['a thread this reviewer started', thread([comment('reviewer-app')])],
    ['a thread without an author', thread([comment(null)])],
    ['a thread this reviewer replied in', thread([comment('codex[bot]'), comment('reviewer-app')])],
    [
      'a thread longer than what was read',
      thread([comment('codex[bot]')], {
        comments: { totalCount: 30, nodes: [comment('codex[bot]')] },
      }),
    ],
    ['a first comment without a link', thread([omitUrl(comment('codex[bot]'))])],
  ])('leaves out %s', (_name, one) => {
    expect(answerableThreads(pull(one), OWN)).toEqual([])
  })

  it('lists nothing without a known identity', () => {
    expect(answerableThreads(pull(thread([comment('codex[bot]')])), new Set())).toEqual([])
  })

  it('keeps at most the cap', () => {
    const many = Array.from({ length: MAX_ANSWERABLE + 3 }, () => thread([comment('codex[bot]')]))
    expect(answerableThreads(pull(...many), OWN)).toHaveLength(MAX_ANSWERABLE)
  })
})

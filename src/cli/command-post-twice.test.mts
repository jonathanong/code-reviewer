import { describe, expect, it, vi } from 'vitest'

import type { ReviewIo } from '../review/index.mts'
import { NO_CONFIGS } from '../review/rules/config.mts'
import type { TrackerIo } from '../tracker/types.mts'
import { postCommand } from './command-post.mts'
import type { ReviewDeps } from './deps.mts'

const SHA = 'e'.repeat(40)
const PULL = { repo: 'acme/widgets', pr: 4 }
const REVIEW = {
  reviewId: 'review-id-0001',
  findings: [{ pillar: 'design', severity: 'low', title: 'T', body: 'b' }],
}

/** A pull request that keeps what is posted to it, so the read-back finds it. */
function fakeIo(): ReviewIo {
  const posted: Array<{ id: number; url: string; body: string; author: string }> = []
  return {
    headSha: async () => SHA,
    listFiles: async () => [],
    listReviews: async () => [...posted],
    trustedAuthors: async () => new Set(['bot']),
    pullAuthor: async () => 'dev',
    standingReviews: async () => [],
    hasApprovalLabel: async () => false,
    postReview: async (review: { body: string }) => {
      const url = 'https://example.test/r'
      posted.push({ id: 7, url, body: review.body, author: 'bot' })
      return url
    },
    addApprovalLabel: async () => undefined,
    removeApprovalLabel: async () => undefined,
  } as unknown as ReviewIo
}

const tracker: TrackerIo = {
  dir: '/state',
  read: () => undefined,
  append: () => undefined,
  write: () => undefined,
  now: () => new Date('2026-05-06T07:08:09.000Z'),
}

function deps(writeFile: ReviewDeps['writeFile'], io: ReviewIo) {
  return {
    authMode: () => 'gh',
    configs: () => NO_CONFIGS,
    targetConfig: async () => ({ config: undefined, problems: [] }),
    createIo: () => io,
    createLabelIo: () => ({ labels: async () => [], add: async () => {}, remove: async () => {} }),
    readFile: () => JSON.stringify(REVIEW),
    writeFile,
    runner: () => async () => '',
    tracker: () => tracker,
  } as unknown as ReviewDeps
}

describe('postCommand twice', () => {
  it('reports a second post of the same review as a no-op and posts once', async () => {
    const io = fakeIo()
    const post = vi.spyOn(io, 'postReview')
    const values = { 'head-sha': SHA, input: '/run/f.json' }
    const first = await postCommand(values, PULL, deps(vi.fn(), io))
    expect(first.outcome.alreadyPosted).not.toBe(true)
    const again = await postCommand(values, PULL, deps(vi.fn(), io))
    expect(post).toHaveBeenCalledOnce()
    expect(again.printed).toMatchObject({
      outcome: 'noop',
      reason: 'review already posted',
      urls: ['https://example.test/r'],
    })
  })
})

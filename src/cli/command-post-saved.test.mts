import { describe, expect, it, vi } from 'vitest'

import type { ReviewIo } from '../review/index.mts'
import { NO_CONFIGS } from '../review/rules/config.mts'
import type { TrackerIo } from '../tracker/types.mts'
import { postCommand } from './command-post.mts'
import type { ReviewDeps } from './deps.mts'

const SHA = 'e'.repeat(40)
const PULL = { repo: 'acme/widgets', pr: 4 }
const REVIEW = { findings: [{ pillar: 'design', severity: 'low', title: 'T', body: 'b' }] }

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

function deps(writeFile: ReviewDeps['writeFile']) {
  return {
    authMode: () => 'gh',
    configs: () => NO_CONFIGS,
    targetConfig: async () => ({ config: undefined, problems: [] }),
    createIo: () => fakeIo(),
    createLabelIo: () => ({ labels: async () => [], add: async () => {}, remove: async () => {} }),
    readFile: () => JSON.stringify(REVIEW),
    writeFile,
    runner: () => async () => '',
    tracker: () => tracker,
  } as unknown as ReviewDeps
}

describe('postCommand saved state', () => {
  it('saves where each finding went beside the input, and prints no placements', async () => {
    const writeFile = vi.fn()
    const values = { 'head-sha': SHA, input: '/run/f.json' }
    const result = await postCommand(values, PULL, deps(writeFile))
    expect(writeFile).toHaveBeenCalledOnce()
    const [path, text] = writeFile.mock.calls[0] as [string, string]
    expect(path).toBe('/run/posted.json')
    expect(JSON.parse(text)).toMatchObject({
      headSha: SHA,
      findings: [{ id: 'F1', title: 'T', placement: 'body' }],
    })
    expect(result.printed).not.toHaveProperty('placements')
    expect(result.outcome.placements).toEqual(['body'])
  })

  it('reports a failed save beside the result, and a dry run saves nothing', async () => {
    const failing = vi.fn(() => {
      throw new Error('disk full')
    })
    const values = { 'head-sha': SHA, input: '/run/f.json' }
    const result = await postCommand(values, PULL, deps(failing))
    expect(result.printed).toMatchObject({ trackerProblem: expect.stringContaining('disk full') })
    const dry = vi.fn()
    const preview = await postCommand({ ...values, 'dry-run': true }, PULL, deps(dry))
    expect(dry).not.toHaveBeenCalled()
    expect(preview.printed).not.toHaveProperty('placements')
  })
})

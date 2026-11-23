import { describe, expect, it, vi } from 'vitest'

import type { ReviewIo } from '../review/index.mts'
import type { PrConversation } from '../review/context-query.mts'
import { parseRepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import type { TrackerIo } from '../tracker/types.mts'
import { postCommand } from './command-post.mts'
import type { ReviewDeps } from './deps.mts'

const SHA = 'e'.repeat(40)
const PULL = { repo: 'acme/widgets', pr: 4 }
const REVIEW = {
  findings: [{ pillar: 'design', severity: 'low', title: 'T', body: 'b' }],
  answers: [{ thread: 'PRT_1', body: 'No lock needed.', at: 'src/a.ts:3' }],
}

const io = (): ReviewIo => {
  const posted: Array<{ id: number; url: string; body: string; author: string }> = []
  return {
    headSha: async () => SHA,
    listFiles: async () => [],
    listReviews: async () => [...posted],
    trustedAuthors: async () => new Set(['bot']),
    pullAuthor: async () => 'dev',
    changesRequested: async () => [],
    hasApprovalLabel: async () => false,
    postReview: async (review: { body: string }) => {
      posted.push({ id: 7, url: 'https://example.test/r', body: review.body, author: 'bot' })
      return 'https://example.test/r'
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

function deps(enabled: boolean) {
  const reply = vi.fn(async (_thread: string, _body: string) => {})
  const configs: RepoConfigs = {
    byRepo: new Map([
      [
        'acme/widgets',
        parseRepoConfig(JSON.stringify({ answers: { enabled } }), 'acme/widgets.json'),
      ],
    ]),
    byOwner: new Map(),
    problems: [],
  }
  const conversation = async () =>
    ({
      reviewThreads: {
        nodes: [
          {
            id: 'PRT_1',
            isResolved: false,
            isOutdated: false,
            path: 'a.ts',
            line: 1,
            comments: { totalCount: 1, nodes: [{ author: { login: 'codex[bot]' } }] },
          },
        ],
      },
    }) as unknown as PrConversation
  const fake = {
    authMode: () => 'gh',
    configs: () => configs,
    targetConfig: async () => ({ config: undefined, problems: [] }),
    createIo: () => io(),
    createAnswerIo: () => ({ conversation, reply }),
    createLabelIo: () => ({ labels: async () => [], add: async () => {}, remove: async () => {} }),
    readFile: () => JSON.stringify(REVIEW),
    writeFile: () => {},
    runner: () => async () => '',
    tracker: () => tracker,
  } as unknown as ReviewDeps
  return { fake, reply }
}

const values = { 'head-sha': SHA, input: '/run/review.json' }

describe('postCommand answers', () => {
  it('replies after the review is posted, and prints what it did', async () => {
    const { fake, reply } = deps(true)
    const result = await postCommand(values, PULL, fake)
    expect(reply).toHaveBeenCalledWith('PRT_1', 'No lock needed.\n\n`src/a.ts:3`')
    expect(result.printed).toMatchObject({
      answers: { replied: ['PRT_1'], skipped: [], failed: [] },
    })
  })

  it('posts the review and no reply when the setting is off', async () => {
    const { fake, reply } = deps(false)
    const result = await postCommand(values, PULL, fake)
    expect(reply).not.toHaveBeenCalled()
    expect(result.printed).toMatchObject({ answers: { off: true } })
    expect(result.outcome.urls).toEqual(['https://example.test/r'])
  })

  it('replies to nothing on a dry run', async () => {
    const { fake, reply } = deps(true)
    const result = await postCommand({ ...values, 'dry-run': true }, PULL, fake)
    expect(reply).not.toHaveBeenCalled()
    expect(result.printed).not.toHaveProperty('answers')
  })
})

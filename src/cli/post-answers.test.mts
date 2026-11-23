import { describe, expect, it, vi } from 'vitest'

import type { PrConversation } from '../review/context-query.mts'
import type { ReviewInput } from '../review/finding.mts'
import { parseRepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import type { ReviewDeps } from './deps.mts'
import { answersFor } from './post-answers.mts'

const PULL = { repo: 'acme/widgets', pr: 4 }
const INPUT = {
  answers: [{ thread: 'T1', body: 'Not needed.', at: 'src/a.ts:3' }],
} as unknown as ReviewInput
const trusted = async () => new Set(['reviewer-app'])

function deps(enabled: boolean | undefined) {
  const reply = vi.fn(async () => {})
  const config = enabled === undefined ? '{}' : JSON.stringify({ answers: { enabled } })
  const configs: RepoConfigs = {
    byRepo: new Map([['acme/widgets', parseRepoConfig(config, 'acme/widgets.json')]]),
    byOwner: new Map(),
    problems: [],
  }
  const conversation = async () =>
    ({
      reviewThreads: {
        nodes: [
          {
            id: 'T1',
            isResolved: false,
            isOutdated: false,
            path: 'a.ts',
            line: 1,
            comments: { totalCount: 1, nodes: [{ author: { login: 'codex[bot]' } }] },
          },
        ],
      },
    }) as unknown as PrConversation
  const createAnswerIo = vi.fn(() => ({ conversation, reply }))
  const fake = { configs: () => configs, createAnswerIo } as unknown as ReviewDeps
  return { fake, reply, createAnswerIo }
}

describe('answersFor', () => {
  it('replies when the setting is on', async () => {
    const { fake, reply } = deps(true)
    const result = await answersFor(fake, PULL, INPUT, trusted, true)
    expect(result).toEqual({ answers: { replied: ['T1'], skipped: [], failed: [] } })
    expect(reply).toHaveBeenCalledWith('T1', 'Not needed.\n\n`src/a.ts:3`')
  })

  it.each([
    ['off', false],
    ['not set', undefined],
  ])('posts nothing and says so when the setting is %s', async (_name, enabled) => {
    const { fake, reply } = deps(enabled)
    expect(await answersFor(fake, PULL, INPUT, trusted, true)).toEqual({ answers: { off: true } })
    expect(reply).not.toHaveBeenCalled()
  })

  it('skips every answer, and replies to none, when the review is not confirmed', async () => {
    const { fake, reply, createAnswerIo } = deps(true)
    expect(await answersFor(fake, PULL, INPUT, trusted, false)).toEqual({
      answers: {
        replied: [],
        skipped: [{ thread: 'T1', why: 'the review was not confirmed as posted' }],
        failed: [],
      },
    })
    expect(reply).not.toHaveBeenCalled()
    expect(createAnswerIo).not.toHaveBeenCalled()
  })

  it('is absent for an input without answers, and never opens the reply path', async () => {
    const { fake, createAnswerIo } = deps(true)
    expect(await answersFor(fake, PULL, {} as ReviewInput, trusted, true)).toEqual({})
    expect(
      await answersFor(fake, PULL, { answers: [] } as unknown as ReviewInput, trusted, true),
    ).toEqual({})
    expect(createAnswerIo).not.toHaveBeenCalled()
  })
})

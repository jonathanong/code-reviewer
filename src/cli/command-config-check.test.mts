import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../review/index.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../review/index.mts')>()),
  prepareReview: vi.fn(async () => ({ headSha: 'h' })),
  claimReview: vi.fn(async () => ({ claimed: true })),
  abortReview: vi.fn(async () => ({})),
  skipPullRequest: vi.fn(async () => ({ headSha: 'h', url: 'u' })),
  postFinalReview: vi.fn(async () => ({ verdict: 'Comment' })),
}))

import {
  abortReview,
  claimReview,
  postFinalReview,
  prepareReview,
  skipPullRequest,
} from '../review/index.mts'
import { runLoopCommand } from './command-loop.mts'
import { postCommand } from './command-post.mts'
import { fakeDeps } from './command-loop-fake-io.mts'
import type { ReviewDeps } from './deps.mts'

const pull = { repo: 'acme/widgets', pr: 4 }
const MACHINE = ['acme.json labels.requested: must be a string; ignored']

afterEach(() => {
  vi.clearAllMocks()
})

describe('a configuration problem stops a command before it works', () => {
  it.each([
    ['claim', {}, claimReview],
    ['abort', {}, abortReview],
    ['skip', { reason: 'docs only' }, skipPullRequest],
    ['prepare', { out: '/o' }, prepareReview],
  ] as const)('%s', async (subcommand, values, work) => {
    const { deps, labelIo } = fakeDeps('app', MACHINE)
    await expect(runLoopCommand(subcommand, values, () => pull, deps)).rejects.toThrow(
      /^settings invalid: acme\.json labels\.requested/u,
    )
    expect(work).not.toHaveBeenCalled()
    expect(labelIo.add).not.toHaveBeenCalled()
    expect(labelIo.remove).not.toHaveBeenCalled()
  })

  it('post, for a problem in the repository file', async () => {
    const { deps } = fakeDeps('app')
    const problem = 'acme/widgets/.code-reviewer.json: unknown key "x" ignored'
    const own = {
      ...deps,
      targetConfig: async () => ({ config: undefined, problems: [problem] }),
      readFile: () => JSON.stringify({ findings: [] }),
    } as unknown as ReviewDeps
    await expect(
      postCommand({ 'head-sha': 'h'.repeat(40), input: 'in.json' }, pull, own),
    ).rejects.toThrow(/^settings invalid: acme\/widgets\/\.code-reviewer\.json/u)
    expect(postFinalReview).not.toHaveBeenCalled()
  })
})

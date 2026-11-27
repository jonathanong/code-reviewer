import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../review/index.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../review/index.mts')>()),
  prepareReview: vi.fn(async () => ({ headSha: 'h' })),
}))

import { prepareReview } from '../review/index.mts'
import { NO_CONFIGS, parseRepoConfig } from '../review/rules/config.mts'
import { runLoopCommand } from './command-loop.mts'
import { fakeDeps, targetConfig } from './command-loop-fake-io.mts'

const target = () => ({ repo: 'acme/widgets', pr: 4 })

afterEach(() => {
  vi.clearAllMocks()
})

describe('prepare plan values', () => {
  it('plans with the plan values the machine and the trusted repository files set', async () => {
    const { deps, prepareIo, configs } = fakeDeps()
    const machine = {
      plan: { authors: [{ login: 'renovate', review: 'skip' }], smallChangeLines: 30 },
      trustRepoConfig: true,
    }
    configs.mockReturnValue({
      ...NO_CONFIGS,
      byRepo: new Map([['acme/widgets', parseRepoConfig(JSON.stringify(machine), 'm.json')]]),
    })
    const own = { plan: { securityPaths: ['infra/**'], generatedPaths: ['gen/**'] } }
    targetConfig.mockResolvedValueOnce({
      config: parseRepoConfig(JSON.stringify(own), 'acme/widgets/.code-reviewer.json', 'trusted'),
      problems: [],
    })
    await runLoopCommand('prepare', { out: '/o' }, target, deps)
    expect(prepareReview).toHaveBeenLastCalledWith(prepareIo, {
      out: '/o',
      earlier: expect.any(Function),
      pillars: { disabled: [], extra: [] },
      values: {
        securityPaths: ['infra/**'],
        generatedPaths: ['gen/**'],
        authors: [{ login: 'renovate', review: 'skip' }],
        smallChangeLines: 30,
        sqlPaths: [],
        followUpSourceLines: 40,
      },
      upgrades: { enabled: false, packages: [] },
    })
  })
})

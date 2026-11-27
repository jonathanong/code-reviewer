import { describe, expect, it, vi } from 'vitest'

import { skipNotice } from '../review/skip.mts'
import { NO_CONFIGS } from '../review/rules/config.mts'
import { claimCommand } from './command-loop.mts'
import type { ReviewDeps } from './deps.mts'

const SHA = 'a'.repeat(40)
const TARGET = { repo: 'acme/widgets', pr: 4 }

function fakeDeps(head: string) {
  const labels = new Set(['final-review:requested', 'final-review:complete'])
  const labelIo = {
    labels: vi.fn(async () => [...labels]),
    add: vi.fn(async (names: string[]) => {
      names.forEach((name) => labels.add(name))
    }),
    heldHead: vi.fn(async () => ({ head: undefined, placements: 0 })),
    remove: vi.fn(async (name: string) => {
      labels.delete(name)
    }),
  }
  const deps = {
    authMode: () => 'gh' as const,
    authIdentity: async () => ({}),
    configs: () => NO_CONFIGS,
    targetConfig: async () => ({ config: undefined, problems: [] }),
    createLabelIo: () => labelIo,
    createIo: () => ({
      headSha: async () => head,
      listReviews: async () => [{ body: skipNotice(SHA, 'lockfile only').body, author: 'bot' }],
      hasApprovalLabel: async () => false,
      trustedAuthors: async () => new Set(['bot']),
    }),
    runner: () => vi.fn(async () => ''),
  } as unknown as ReviewDeps
  return { deps, labelIo }
}

describe('claim on a skipped head', () => {
  it('declines like any already-reviewed head and reports the skipped status', async () => {
    const { deps, labelIo } = fakeDeps(SHA)
    const outcome = await claimCommand({}, () => TARGET, deps)
    expect(outcome).toMatchObject({
      claimed: false,
      reason: 'head already reviewed',
      status: { verdict: 'Skipped', current: true, skipped: true, approved: false },
    })
    expect(labelIo.add).not.toHaveBeenCalledWith(['final-review:in-progress'])
  })

  it('claims with --force', async () => {
    const { deps, labelIo } = fakeDeps(SHA)
    await expect(claimCommand({ force: true }, () => TARGET, deps)).resolves.toMatchObject({
      claimed: true,
    })
    expect(labelIo.add).toHaveBeenCalledWith(['final-review:in-progress'])
  })

  it('claims a new head after the skipped one', async () => {
    const { deps } = fakeDeps('b'.repeat(40))
    await expect(claimCommand({}, () => TARGET, deps)).resolves.toMatchObject({ claimed: true })
  })
})

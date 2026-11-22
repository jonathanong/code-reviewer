import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../review/index.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../review/index.mts')>()),
  prepareReview: vi.fn(async () => ({ headSha: 'h' })),
}))

import { EARLIER_HEAD, memoryTracker, row } from '../review/earlier-fake-io.mts'
import { prepareReview } from '../review/index.mts'
import type { PrepareOptions } from '../review/prepare.mts'
import { runLoopCommand } from './command-loop.mts'
import { fakeDeps } from './command-loop-fake-io.mts'

afterEach(() => {
  vi.clearAllMocks()
})

/** The lookup `prepare` is handed, bound to a pull request whose tracker holds one unposted review. */
async function lookupFor(out: string): Promise<NonNullable<PrepareOptions['earlier']>> {
  const { deps } = fakeDeps()
  const tracker = memoryTracker([row({ repo: 'acme/widgets', pr: 4 })])
  const target = () => ({ repo: 'acme/widgets', pr: 4 })
  await runLoopCommand('prepare', { out }, target, { ...deps, tracker: () => tracker })
  const options = vi.mocked(prepareReview).mock.lastCall?.[1] as PrepareOptions
  return options.earlier as NonNullable<PrepareOptions['earlier']>
}

describe('prepare and an unposted review on this machine', () => {
  it('looks the pull request up in the tracker for the head prepare finds', async () => {
    const earlier = await lookupFor('/o')
    expect(earlier('a'.repeat(40))?.sha).toBe(EARLIER_HEAD)
    expect(earlier(EARLIER_HEAD)).toBeUndefined()
  })

  it('does not take the run directory it is preparing into', async () => {
    const earlier = await lookupFor('/state/runs/o/r/7-bbbbbbbbbbbb')
    expect(earlier('a'.repeat(40))).toBeUndefined()
  })
})

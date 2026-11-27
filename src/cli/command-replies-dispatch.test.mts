import { describe, expect, it, vi } from 'vitest'

vi.mock('./command-replies.mts', () => ({ runRepliesCommand: vi.fn(async () => 11) }))

import { runReviewCommand, type ReviewDeps } from './command.mts'
import { runRepliesCommand } from './command-replies.mts'

describe('runReviewCommand replies', () => {
  it('hands the parsed flags to the replies command', async () => {
    const deps = {} as ReviewDeps
    await expect(
      runReviewCommand(['replies', '--repo', 'acme/widgets', '--pr', '4'], deps),
    ).resolves.toBe(11)
    expect(runRepliesCommand).toHaveBeenCalledWith(
      expect.objectContaining({ repo: ['acme/widgets'], pr: '4' }),
      deps,
    )
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('./command-wait.mts', () => ({ runWaitCommand: vi.fn(async () => 11) }))

import { runReviewCommand, type ReviewDeps } from './command.mts'
import { runWaitCommand } from './command-wait.mts'

describe('runReviewCommand wait', () => {
  it('hands the parsed flags to the wait command', async () => {
    const deps = {} as ReviewDeps
    await expect(
      runReviewCommand(
        [
          'wait',
          '--owner',
          'acme,other',
          '--timeout',
          '2h',
          '--ignore-sender',
          'a[bot]',
          '--label',
          'x',
        ],
        deps,
      ),
    ).resolves.toBe(11)
    expect(runWaitCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme,other',
        timeout: '2h',
        'ignore-sender': ['a[bot]'],
        label: ['x'],
      }),
      deps,
    )
  })
})

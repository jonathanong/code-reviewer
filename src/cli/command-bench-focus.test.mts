import { describe, expect, it, vi } from 'vitest'

import { runReviewCommand, type ReviewDeps } from './command.mts'

describe('runReviewCommand bench-focus', () => {
  it('forwards its arguments without parsing them', async () => {
    const runFocusBench = vi.fn(async () => 4)
    const deps = { runFocusBench } as unknown as ReviewDeps
    await expect(runReviewCommand(['bench-focus', '--out', 'o'], deps)).resolves.toBe(4)
    expect(runFocusBench).toHaveBeenCalledWith(['--out', 'o'])
  })
})

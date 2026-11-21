import { describe, expect, it, vi } from 'vitest'

import { runReviewCommand, type ReviewDeps } from './command.mts'

describe('runReviewCommand bench-context', () => {
  it('forwards its arguments without parsing them', async () => {
    const runContextBench = vi.fn(async () => 8)
    const deps = { runContextBench } as unknown as ReviewDeps
    await expect(runReviewCommand(['bench-context', '--out', 'o'], deps)).resolves.toBe(8)
    expect(runContextBench).toHaveBeenCalledWith(['--out', 'o'])
  })
})

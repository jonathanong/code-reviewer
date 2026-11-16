import { describe, expect, it, vi } from 'vitest'

import { withRetry } from './retry.ts'

vi.mock('./settings.ts', () => ({ retryLimit: () => 2 }))

describe('withRetry', () => {
  it('returns the result of the first attempt that succeeds', async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValueOnce('ok')
    await expect(withRetry(task)).resolves.toBe('ok')
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('throws the last error once the attempts are used up', async () => {
    const task = vi.fn().mockRejectedValue(new Error('down'))
    await expect(withRetry(task)).rejects.toThrow('down')
    expect(task).toHaveBeenCalledTimes(2)
  })
})

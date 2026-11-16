import { describe, expect, it, vi } from 'vitest'

import { resolveThreads } from './threads.mts'

describe('resolveThreads', () => {
  it('resolves each thread through a mutation', async () => {
    const run = vi.fn(async (_args: readonly string[]) => '')
    expect(await resolveThreads(run, ['PRRT_a', 'PRRT_b='])).toEqual(['PRRT_a', 'PRRT_b='])
    expect(run).toHaveBeenCalledTimes(2)
    const args = run.mock.calls[0]?.[0] as string[]
    expect(args.slice(0, 3)).toEqual(['api', 'graphql', '-f'])
    expect(args[3]).toContain('resolveReviewThread')
    expect(args.slice(4)).toEqual(['-f', 'id=PRRT_a', '--silent'])
  })

  it('rejects invalid ids before running anything', async () => {
    const run = vi.fn(async (_args: readonly string[]) => '')
    await expect(resolveThreads(run, ['ok', 'bad id'])).rejects.toThrow('Invalid thread id: bad id')
    expect(run).not.toHaveBeenCalled()
  })

  it('handles no ids', async () => {
    expect(await resolveThreads(vi.fn(), [])).toEqual([])
  })
})

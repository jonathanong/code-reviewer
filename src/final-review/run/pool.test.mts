import { describe, expect, it } from 'vitest'

import { pool } from './pool.mts'

describe('pool', () => {
  it('runs every item with at least one worker', async () => {
    const seen: number[] = []
    await pool([1, 2, 3], 0, async (n) => void seen.push(n))
    expect(seen).toEqual([1, 2, 3])
  })

  it('never has more than `jobs` items in flight', async () => {
    let active = 0
    let peak = 0
    await pool([1, 2, 3, 4, 5], 2, async () => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
    })
    expect(peak).toBe(2)
  })
})

import { describe, expect, it } from 'vitest'

import { formatDuration } from './format-duration.mts'

describe('formatDuration', () => {
  it('formats milliseconds, seconds, and minutes', () => {
    expect(formatDuration(250)).toBe('250ms')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(65_000)).toBe('1m 5s')
  })
})

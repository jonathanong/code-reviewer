import { describe, expect, it } from 'vitest'

import { formatDuration } from './format-duration.mts'

describe('formatDuration', () => {
  it('formats milliseconds and seconds', () => {
    expect(formatDuration(250)).toBe('250ms')
    expect(formatDuration(1500)).toBe('1.5s')
  })
})

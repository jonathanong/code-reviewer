import { describe, expect, it } from 'vitest'

import { parseAmount } from './amount.ts'

const message = (input: string) =>
  `Amount must be a positive whole number of cents, got "${input}"`

describe('parseAmount', () => {
  it('parses whole cents', () => {
    expect(parseAmount('250')).toBe(250)
  })

  it('rejects fractions, zero, and text', () => {
    expect(() => parseAmount('2.5')).toThrow(message('2.5'))
    expect(() => parseAmount('0')).toThrow(message('0'))
    expect(() => parseAmount('ten')).toThrow(message('ten'))
  })
})

import { describe, expect, it } from 'vitest'

import { InvalidAmountError, parseAmount } from './amount.ts'

// The exact message of the error parseAmount throws; toThrow(string) only matches a substring.
function thrownMessage(input: string): string {
  try {
    parseAmount(input)
  } catch (error) {
    if (error instanceof InvalidAmountError) return error.message
    throw error
  }
  throw new Error(`parseAmount(${JSON.stringify(input)}) did not throw`)
}

describe('parseAmount', () => {
  it('parses whole cents', () => {
    expect(parseAmount('250')).toBe(250)
  })

  it('rejects fractions, zero, and text with the exact user-facing message', () => {
    expect(thrownMessage('2.5')).toBe('Amount must be a positive whole number of cents, got "2.5"')
    expect(thrownMessage('0')).toBe('Amount must be a positive whole number of cents, got "0"')
    expect(thrownMessage('ten')).toBe('Amount must be a positive whole number of cents, got "ten"')
  })
})

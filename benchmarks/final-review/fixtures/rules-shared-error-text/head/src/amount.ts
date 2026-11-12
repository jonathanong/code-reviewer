export class InvalidAmountError extends Error {
  readonly code = 'INVALID_AMOUNT'
  constructor(readonly input: string) {
    super(`Amount must be a positive whole number of cents, got "${input}"`)
  }
}

export function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function parseAmount(input: string): number {
  const value = Number(input)
  if (!Number.isInteger(value) || value <= 0) throw new InvalidAmountError(input)
  return value
}

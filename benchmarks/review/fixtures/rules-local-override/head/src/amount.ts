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
  if (!/^[1-9]\d*$/u.test(input)) throw new InvalidAmountError(input)
  const value = Number(input)
  if (!Number.isSafeInteger(value)) throw new InvalidAmountError(input)
  return value
}

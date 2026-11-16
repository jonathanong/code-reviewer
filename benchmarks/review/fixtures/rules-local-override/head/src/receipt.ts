import { formatAmount } from './amount.ts'

export function receiptLine(label: string, cents: number): string {
  return `${label}: ${formatAmount(cents)}`
}

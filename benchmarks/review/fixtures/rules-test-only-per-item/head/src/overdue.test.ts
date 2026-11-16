import { describe, expect, it } from 'vitest'

import { overdueInvoices, type Invoice } from './overdue.ts'

const now = new Date('2026-03-01T00:00:00Z')

function invoice(id: string, dueAt: string, paidAt: string | null = null): Invoice {
  return { id, dueAt: new Date(dueAt), paidAt: paidAt === null ? null : new Date(paidAt) }
}

describe('overdueInvoices', () => {
  it('returns only unpaid invoices that are past due', () => {
    const invoices = [
      invoice('a', '2026-02-01T00:00:00Z'),
      invoice('b', '2026-02-10T00:00:00Z', '2026-02-11T00:00:00Z'),
      invoice('c', '2026-04-01T00:00:00Z'),
    ]
    for (const found of overdueInvoices(invoices, now)) {
      expect(found.paidAt).toBeNull()
      expect(found.dueAt.getTime()).toBeLessThan(now.getTime())
    }
  })

  it('returns nothing when there are no invoices', () => {
    expect(overdueInvoices([], now)).toEqual([])
  })
})

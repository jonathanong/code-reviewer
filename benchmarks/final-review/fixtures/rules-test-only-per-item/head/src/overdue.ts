export type Invoice = { id: string; dueAt: Date; paidAt: Date | null }

/** Invoices that are unpaid and past due at `now`, oldest first. */
export function overdueInvoices(invoices: readonly Invoice[], now: Date): Invoice[] {
  return invoices
    .filter((invoice) => invoice.paidAt === null && invoice.dueAt.getTime() < now.getTime())
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
}

export function formatInvoiceRow(row) {
  return `${row.id},${(row.total_cents / 100).toFixed(2)}`
}

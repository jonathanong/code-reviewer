import { listInvoicePage } from '../exports/list-invoice-page.mjs'
import { snapshotInvoiceIds } from '../exports/snapshot-invoice-ids.mjs'

const PAGE = 500

export async function runExport(db, accountId) {
  const ids = []
  for (let cursor = null; ;) {
    const page = await snapshotInvoiceIds(db, accountId, cursor, PAGE)
    ids.push(...page)
    if (page.length < PAGE) break
    cursor = page[page.length - 1]
  }
  const rows = []
  for (let cursor = null; ;) {
    const page = await listInvoicePage(db, accountId, cursor, PAGE)
    rows.push(...page)
    if (page.length < PAGE) break
    cursor = page[page.length - 1].id
  }
  return { ids, rows }
}

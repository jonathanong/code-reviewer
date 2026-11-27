import { expect, it } from 'vitest'
import { snapshotInvoiceIds } from '../src/exports/snapshot-invoice-ids.mjs'

it('returns ids in order', async () => {
  const db = { query: async () => ({ rows: [{ id: 'a' }, { id: 'b' }] }) }
  expect(await snapshotInvoiceIds(db, 'acct', null, 10)).toEqual(['a', 'b'])
})

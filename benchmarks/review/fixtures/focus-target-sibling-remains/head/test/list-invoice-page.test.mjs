import { expect, it } from 'vitest'
import { listInvoicePage } from '../src/exports/list-invoice-page.mjs'

function fakeDb() {
  const calls = []
  return { calls, query: async (text, params) => (calls.push({ text, params }), { rows: [] }) }
}

it('omits the cursor condition on the first page', async () => {
  const db = fakeDb()
  await listInvoicePage(db, 'acct', null, 10)
  expect(db.calls[0].text).not.toContain('id >')
  expect(db.calls[0].params).toEqual(['acct', 10])
})

it('seeks from the cursor on a continuation page', async () => {
  const db = fakeDb()
  await listInvoicePage(db, 'acct', 'inv_5', 10)
  expect(db.calls[0].text).toContain('id > $2::text')
  expect(db.calls[0].params).toEqual(['acct', 'inv_5', 10])
})

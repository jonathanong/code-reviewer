export async function listInvoicePage(db, accountId, cursor, limit) {
  const params = [accountId]
  let text = 'SELECT id, total_cents FROM invoices WHERE account_id = $1::uuid'
  if (cursor !== null) {
    params.push(cursor)
    text += ` AND id > $${params.length}::text`
  }
  params.push(limit)
  text += ` ORDER BY id LIMIT $${params.length}::integer`
  const { rows } = await db.query(text, params)
  return rows
}

export async function snapshotInvoiceIds(db, accountId, cursor, limit) {
  const params = [accountId]
  let cursorFilter = ''
  if (cursor !== null) {
    params.push(cursor)
    cursorFilter = ` AND id > $${params.length}::text`
  }
  params.push(limit)
  const { rows } = await db.query(
    `WITH page AS (
      SELECT id FROM invoices
      WHERE account_id = $1::uuid AND status <> 'void'${cursorFilter}
      ORDER BY id LIMIT $${params.length}::integer
    )
    SELECT id FROM page ORDER BY id`,
    params,
  )
  return rows.map((row) => row.id)
}

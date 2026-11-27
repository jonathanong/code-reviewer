export async function snapshotInvoiceIds(db, accountId, cursor, limit) {
  const { rows } = await db.query(
    `WITH page AS (
      SELECT id FROM invoices
      WHERE account_id = $1::uuid AND status <> 'void' AND ($2::text is null or id > $2)
      ORDER BY id LIMIT $3::integer
    )
    SELECT id FROM page ORDER BY id`,
    [accountId, cursor, limit],
  )
  return rows.map((row) => row.id)
}

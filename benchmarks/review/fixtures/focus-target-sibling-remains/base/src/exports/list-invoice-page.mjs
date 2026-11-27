export async function listInvoicePage(db, accountId, cursor, limit) {
  const { rows } = await db.query(
    `SELECT id, total_cents FROM invoices
      WHERE account_id = $1::uuid AND ($2::text IS NULL OR id > $2)
      ORDER BY id LIMIT $3::integer`,
    [accountId, cursor, limit],
  )
  return rows
}

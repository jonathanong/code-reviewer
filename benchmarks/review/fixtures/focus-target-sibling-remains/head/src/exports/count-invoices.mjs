export async function countInvoices(db, accountId) {
  const { rows } = await db.query(
    'SELECT count(*)::integer AS n FROM invoices WHERE account_id = $1::uuid',
    [accountId],
  )
  return rows[0].n
}

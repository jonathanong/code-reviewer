// Prints the plan of a continuation page so a reviewer can see the index range.
export async function explainContinuation(db, accountId, cursor) {
  const { rows } = await db.query(
    'EXPLAIN SELECT id, total_cents FROM invoices WHERE account_id = $1::uuid AND id > $2::text ORDER BY id LIMIT 500',
    [accountId, cursor],
  )
  return rows.map((row) => row['QUERY PLAN']).join('\n')
}

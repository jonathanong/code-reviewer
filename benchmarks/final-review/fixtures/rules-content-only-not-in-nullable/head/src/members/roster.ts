import { pool } from '../platform/client.ts'

const MAX_PAGE = 100

/** Ids of members who have never been sent an invite, in id order. */
export async function uninvitedMembers(limit: number): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT id FROM members
     WHERE id NOT IN (SELECT member_id FROM invites)
     ORDER BY id
     LIMIT $1`,
    [Math.min(limit, MAX_PAGE)],
  )
  return rows.map((row) => row.id)
}

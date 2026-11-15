import { z } from 'zod'

import { createRefund } from '../refunds.ts'

const RefundBody = z.object({ amount_cents: z.number().int().positive() }).strict()

/** POST /orders/:id/refunds; answers 400 when the body does not match. */
export async function postRefund(orderId: string, raw: unknown) {
  const body = RefundBody.safeParse(raw)
  if (!body.success) return { status: 400, body: { error: 'invalid body' } }
  const refund = await createRefund(orderId, body.data.amount_cents)
  return { status: 201, body: { id: refund.id, status: refund.status } }
}

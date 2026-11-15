import { post } from './http.ts'

export type Refund = { id: string; status: string }

/** Refunds part of an order; `amountCents` is what the customer gets back. */
export async function requestRefund(orderId: string, amountCents: number): Promise<Refund> {
  const body = await post(`/orders/${orderId}/refunds`, { amount: amountCents / 100 })
  return { id: body.id, status: body.status }
}

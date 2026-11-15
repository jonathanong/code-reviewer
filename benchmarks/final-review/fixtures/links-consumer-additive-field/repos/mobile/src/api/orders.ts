import { get } from './http.ts'

export type Order = { id: string; status: string; totalCents: number }

export async function fetchOrder(id: string): Promise<Order> {
  const body = await get(`/orders/${id}`)
  return { id: body.id, status: body.status, totalCents: body.total_cents }
}

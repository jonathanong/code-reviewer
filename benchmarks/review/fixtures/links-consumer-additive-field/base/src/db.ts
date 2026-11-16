export type OrderRow = { id: string; status: string; total_cents: number; currency: string }

export declare const db: {
  one(sql: string, params: unknown[]): Promise<OrderRow | undefined>
}

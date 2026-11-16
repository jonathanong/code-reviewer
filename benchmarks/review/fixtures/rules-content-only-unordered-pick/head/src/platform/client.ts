export type Tx = {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
}

export async function inTx<T>(_work: (tx: Tx) => Promise<T>): Promise<T> {
  throw new Error('not connected')
}

export async function sendReminder(_id: string): Promise<void> {}

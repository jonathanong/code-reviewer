export type Client = {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<{ id: string }> }>
  release(): void
}

export const pool = {
  async connect(): Promise<Client> {
    return {
      async query() {
        return { rows: [] }
      },
      release() {},
    }
  },
}

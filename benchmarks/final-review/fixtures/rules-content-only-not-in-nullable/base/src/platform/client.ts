export const pool = {
  async query(_text: string, _values: unknown[]): Promise<{ rows: Array<{ id: string }> }> {
    return { rows: [] }
  },
}

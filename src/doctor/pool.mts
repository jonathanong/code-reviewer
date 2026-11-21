/** Maps `items` with at most `limit` calls in flight; results keep the order of `items`. */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from<R>({ length: items.length })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** The first line of an error's message, which is all a one-line check needs. */
export function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] as string
}

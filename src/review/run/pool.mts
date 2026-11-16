/** Runs `work` over `items` with at most `jobs` in flight. */
export async function pool<T>(
  items: readonly T[],
  jobs: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item)
  }
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker))
}

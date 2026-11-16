/** Calls `task` up to `attempts` times and rethrows the last error. */
export async function withRetry<T>(attempts: number, task: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await task()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

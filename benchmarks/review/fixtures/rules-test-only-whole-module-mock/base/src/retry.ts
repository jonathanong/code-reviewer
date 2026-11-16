import { retryLimit } from './settings.ts'

/** Calls `task` until it succeeds or the configured number of attempts is used up. */
export async function withRetry<T>(task: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < retryLimit(); attempt++) {
    try {
      return await task()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

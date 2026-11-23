import { backoffDelay } from './backoff.mts'

export type Sleep = (ms: number) => Promise<void>

/** Runs `task` up to `attempts` times, sleeping the backoff delay between failures. */
export async function retry<T>(task: () => Promise<T>, attempts: number, sleep: Sleep): Promise<T> {
  let failure: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      failure = error
      if (attempt < attempts) await sleep(backoffDelay(attempt))
    }
  }
  throw failure
}

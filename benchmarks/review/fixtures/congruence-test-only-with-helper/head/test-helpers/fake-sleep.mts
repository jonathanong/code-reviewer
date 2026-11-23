/** A sleep that records the delays it was asked for and resolves at once. */
export function fakeSleep(): {
  delays: number[]
  sleep: (ms: number) => Promise<void>
  total: () => number
} {
  const delays: number[] = []
  return {
    delays,
    sleep: async (ms) => void delays.push(ms),
    total: () => delays.reduce((sum, ms) => sum + ms, 0),
  }
}

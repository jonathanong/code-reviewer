export async function runSweep(sweep: () => Promise<number>): Promise<number> {
  return await sweep()
}

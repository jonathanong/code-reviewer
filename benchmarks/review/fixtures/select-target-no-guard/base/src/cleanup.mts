export async function runSweep(
  lock: { acquire(): Promise<boolean>; release(): Promise<void> },
  sweep: () => Promise<number>,
): Promise<number> {
  if (!(await lock.acquire())) return 0
  try {
    return await sweep()
  } finally {
    await lock.release()
  }
}

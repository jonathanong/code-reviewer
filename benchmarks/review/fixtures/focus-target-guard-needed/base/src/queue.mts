export type Job = { name: string; exportId: string }

/** Workers per process; several processes run this queue. */
export const EXPORT_WORKER_CONCURRENCY = 4

export async function enqueueExport(
  queue: { add(name: string, job: Job): Promise<void> },
  exportId: string,
): Promise<void> {
  await queue.add('export', { name: 'export', exportId })
}

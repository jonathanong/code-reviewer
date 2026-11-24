import { enqueueExport } from './queue.mts'

type Queue = Parameters<typeof enqueueExport>[0]

/** Nightly schedule: enqueues every pending export. */
export async function nightly(queue: Queue, pending: readonly string[]): Promise<void> {
  for (const exportId of pending) await enqueueExport(queue, exportId)
}

/** The "export now" button: enqueues one export on request. */
export async function exportNow(queue: Queue, exportId: string): Promise<void> {
  await enqueueExport(queue, exportId)
}

import type { Job } from './queue.mts'

export type Store = {
  /** UPDATE exports SET state = 'running' WHERE id = $1 AND state = 'pending'; true when a row changed. */
  claim(exportId: string): Promise<boolean>
  send(exportId: string): Promise<void>
}

export async function runExport(store: Store, job: Job): Promise<void> {
  if (!(await store.claim(job.exportId))) return
  await store.send(job.exportId)
}

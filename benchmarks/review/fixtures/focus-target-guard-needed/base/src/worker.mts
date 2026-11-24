import type { Job } from './queue.mts'

export type Store = {
  claim(exportId: string): Promise<boolean>
  send(exportId: string): Promise<void>
}

export async function runExport(store: Store, job: Job): Promise<void> {
  await store.send(job.exportId)
}

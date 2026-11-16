import { db, queue } from '../platform/client.ts'

export async function changePlan(memberId: string, plan: string): Promise<void> {
  await db.updatePlan(memberId, plan)
  await queue.add(
    'sync-plan',
    { memberId },
    { jobId: `sync-plan:${memberId}`, removeOnComplete: { age: 86_400 } },
  )
}

import { db } from '../platform/client.ts'

export async function changePlan(memberId: string, plan: string): Promise<void> {
  await db.updatePlan(memberId, plan)
}

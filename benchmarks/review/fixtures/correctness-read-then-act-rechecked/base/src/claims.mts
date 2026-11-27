export type Claim = { jobId: string; token: string; renewedAt: number }

export type ClaimStore = {
  get(jobId: string): Promise<Claim | undefined>
  deleteIfToken(jobId: string, token: string): Promise<boolean>
  delete(jobId: string): Promise<void>
}

const TIMEOUT_MS = 60_000

export async function releaseStale(
  store: ClaimStore,
  jobId: string,
  now: number,
): Promise<boolean> {
  const claim = await store.get(jobId)
  if (!claim || now - claim.renewedAt < TIMEOUT_MS) return false
  await store.delete(jobId)
  return true
}

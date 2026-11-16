export function retryLimit(): number {
  return Number(process.env.RETRY_LIMIT ?? 3)
}

export function timeoutMs(): number {
  return Number(process.env.TIMEOUT_MS ?? 5000)
}

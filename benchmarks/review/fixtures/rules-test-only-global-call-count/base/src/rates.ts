import { ratesUrl } from './settings.ts'

/** The exchange rate from USD to `currency`, from the rates service. */
export async function fetchRate(currency: string): Promise<number> {
  const response = await fetch(`${ratesUrl()}/rates/${encodeURIComponent(currency)}`)
  if (!response.ok) throw new RateError(currency, response.status)
  const body = (await response.json()) as { rate: number }
  return body.rate
}

export class RateError extends Error {
  readonly code = 'RATE_UNAVAILABLE'
  constructor(
    readonly currency: string,
    readonly status: number,
  ) {
    super('Rate unavailable')
  }
}

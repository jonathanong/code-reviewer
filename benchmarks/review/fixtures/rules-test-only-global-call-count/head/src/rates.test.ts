import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchRate, RateError } from './rates.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchRate', () => {
  it('returns the rate from the rates service', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ rate: 1.25 }), { status: 200 }))
    await expect(fetchRate('EUR')).resolves.toBe(1.25)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('throws RateError with the status when the service fails', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 503 }))
    await expect(fetchRate('EUR')).rejects.toMatchObject({
      code: 'RATE_UNAVAILABLE',
      currency: 'EUR',
      status: 503,
    })
    await expect(fetchRate('EUR')).rejects.toBeInstanceOf(RateError)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

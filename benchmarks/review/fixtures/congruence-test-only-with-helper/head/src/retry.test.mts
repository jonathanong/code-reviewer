import { expect, it } from 'vitest'

import { fakeSleep } from '../test-helpers/fake-sleep.mts'
import { retry } from './retry.mts'

it('returns the first success without sleeping', async () => {
  const clock = fakeSleep()
  await expect(retry(async () => 'ok', 3, clock.sleep)).resolves.toBe('ok')
  expect(clock.delays).toEqual([])
})

it('sleeps between failures and rethrows the last one', async () => {
  const clock = fakeSleep()
  const failing = async (): Promise<never> => {
    throw new Error('down')
  }
  await expect(retry(failing, 3, clock.sleep)).rejects.toThrow('down')
  expect(clock.delays).toEqual([200, 400])
  expect(clock.total()).toBe(600)
})

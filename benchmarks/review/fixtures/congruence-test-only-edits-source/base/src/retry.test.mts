import { expect, it } from 'vitest'

import { fakeSleep } from '../test-helpers/fake-sleep.mts'
import { retry } from './retry.mts'

it('returns the first success without sleeping', async () => {
  const clock = fakeSleep()
  await expect(retry(async () => 'ok', 3, clock.sleep)).resolves.toBe('ok')
  expect(clock.delays).toEqual([])
})

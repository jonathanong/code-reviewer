import { expect, it } from 'vitest'

import { backoffDelay } from './backoff.mts'

it('caps the delay', () => {
  expect(backoffDelay(20)).toBe(30_000)
})

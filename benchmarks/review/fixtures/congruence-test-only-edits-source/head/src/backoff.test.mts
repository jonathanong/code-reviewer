import { expect, it } from 'vitest'

import { backoffDelay } from './backoff.mts'

it('caps the delay', () => {
  expect(backoffDelay(20)).toBe(30_000)
})

it('starts at the base delay', () => {
  expect(backoffDelay(1)).toBe(200)
})

it('doubles on each retry', () => {
  expect([1, 2, 3, 4].map((attempt) => backoffDelay(attempt))).toEqual([200, 400, 800, 1600])
})

it('uses a custom base and cap', () => {
  expect(backoffDelay(3, 50, 150)).toBe(150)
})

it('rejects an attempt below 1', () => {
  expect(() => backoffDelay(0)).toThrow(RangeError)
})

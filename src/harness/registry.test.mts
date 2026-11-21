import { expect, it } from 'vitest'

import { harness } from './claude.mts'
import { HARNESS_NAMES, harnessNamed } from './registry.mts'

it('registers claude and knows no other name', () => {
  expect(HARNESS_NAMES).toEqual(['claude'])
  expect(harnessNamed('claude')).toBe(harness)
  expect(harnessNamed('nope')).toBeUndefined()
})

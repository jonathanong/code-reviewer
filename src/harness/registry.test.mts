import { expect, it } from 'vitest'

import { harness } from './claude.mts'
import { HARNESS_NAMES, harnessNamed } from './registry.mts'

it('registers claude, grok, opencode, codex and agy and knows no other name', () => {
  expect(HARNESS_NAMES).toEqual(['claude', 'grok', 'opencode', 'codex', 'agy'])
  expect(harnessNamed('agy')?.name).toBe('agy')
  expect(harnessNamed('claude')).toBe(harness)
  expect(harnessNamed('grok')?.name).toBe('grok')
  expect(harnessNamed('opencode')?.name).toBe('opencode')
  expect(harnessNamed('nope')).toBeUndefined()
})

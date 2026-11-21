import { describe, expect, it } from 'vitest'

import { changedKeys } from './config-keys.mts'

describe('changedKeys', () => {
  it('lists dotted keys whose value differs, added, removed or changed', () => {
    const before = JSON.stringify({ rules: { a: 'off', b: 'warn' }, plugins: ['x'] })
    const after = JSON.stringify({ rules: { a: 'error', c: 'warn' }, plugins: ['x'] })
    expect(changedKeys(before, after)).toEqual(['rules.a', 'rules.b', 'rules.c'])
  })

  it('treats a missing side as empty and returns null for non-JSON', () => {
    expect(changedKeys(null, '{"a":1}')).toEqual(['a'])
    expect(changedKeys('{"a":1}', null)).toEqual(['a'])
    expect(changedKeys('{ // comment\n}', '{}')).toBeNull()
  })

  it('stops flattening at three levels', () => {
    expect(changedKeys('{"a":{"b":{"c":{"d":1}}}}', '{"a":{"b":{"c":{"d":2}}}}')).toEqual(['a.b.c'])
  })
})

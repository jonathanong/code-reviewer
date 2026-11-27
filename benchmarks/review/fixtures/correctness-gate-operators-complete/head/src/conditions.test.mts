import { expect, test } from 'vitest'
import { evalCondition, PolicyError } from './conditions.mts'

test('orders numbers', () => {
  expect(evalCondition(80, '>=', 80)).toBe(true)
  expect(evalCondition(79, '>=', 80)).toBe(false)
  expect(evalCondition(2, '<', 10)).toBe(true)
  expect(evalCondition(10, '<=', 9)).toBe(false)
  expect(evalCondition(10, '>', 9)).toBe(true)
})

test('orders ordinals by position, not alphabetically', () => {
  expect(evalCondition('low', '<', 'medium')).toBe(true)
  expect(evalCondition('medium', '<', 'high')).toBe(true)
  expect(evalCondition('high', '>=', 'high')).toBe(true)
  expect(evalCondition('high', '<=', 'low')).toBe(false)
})

test('rejects a malformed pairing', () => {
  expect(() => evalCondition(1, '<', 'high')).toThrow(PolicyError)
  expect(() => evalCondition('urgent', '>', 'low')).toThrow(PolicyError)
  expect(() => evalCondition('urgent', '>', 'urgent')).toThrow(PolicyError)
})

import { expect, test } from 'vitest'
import { checkAlwaysHuman } from './always-human.mts'

const covered = (rule: object) => ({
  rules: ['deploy/', 'secrets/'].map((p) => ({ paths: [p], ...rule })),
})

test('accepts a rule with a human seat', () => {
  expect(() =>
    checkAlwaysHuman(covered({ claude: 'approve', seats: ['ana'] }) as never),
  ).not.toThrow()
})

test('refuses a protected path with no rule', () => {
  expect(() => checkAlwaysHuman({ rules: [] })).toThrow('no rule covers')
})

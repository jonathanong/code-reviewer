import { deepStrictEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { checkQueues } from './check.mts'

const ambiguous = [{ name: 'mail', ambiguous: true, sources: ['a.mts', 'b.mts'] }]

test('an ambiguous queue abstains for a flow binding', () => {
  const out = checkQueues([{ kind: 'flow', queue: 'mail', file: 'flows.mts' }], ambiguous)
  deepStrictEqual(
    out.map((d) => d.code),
    ['abstained'],
  )
})

test('an unknown queue is reported', () => {
  const out = checkQueues([{ kind: 'flow', queue: 'gone', file: 'flows.mts' }], ambiguous)
  deepStrictEqual(
    out.map((d) => d.code),
    ['unknown-queue'],
  )
})

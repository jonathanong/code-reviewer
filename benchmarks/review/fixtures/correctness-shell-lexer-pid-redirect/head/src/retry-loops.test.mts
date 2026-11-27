import { deepStrictEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { findRetryLoops } from './retry-loops.mts'

test('a loop that reruns the test with nothing that changes is a retry', () => {
  const script = 'for attempt in 1 2 3; do\n  pnpm test && break\ndone'
  deepStrictEqual(findRetryLoops(script, 'pnpm test'), ['attempt'])
})

test('a loop that passes its variable to the test is not a retry', () => {
  const script = 'for suite in unit e2e; do pnpm test --shard "$suite"; done'
  deepStrictEqual(findRetryLoops(script, 'pnpm test'), [])
})

test('a test fed by a pipeline stage is found, and a loop variable piped in is input', () => {
  const script = 'for suite in unit e2e; do printf \'%s\\n\' "$suite" | pnpm test; done'
  deepStrictEqual(findRetryLoops(script, 'pnpm test'), [])
  const rerun = 'for attempt in 1 2 3; do echo go | pnpm test; done'
  deepStrictEqual(findRetryLoops(rerun, 'pnpm test'), ['attempt'])
})

test('a single-quoted or escaped dollar is not an expansion', () => {
  const quoted = "for attempt in 1 2 3; do echo '$attempt'; pnpm test; done"
  deepStrictEqual(findRetryLoops(quoted, 'pnpm test'), ['attempt'])
  const escaped = 'for attempt in 1 2 3; do echo \\$attempt; pnpm test; done'
  deepStrictEqual(findRetryLoops(escaped, 'pnpm test'), ['attempt'])
})

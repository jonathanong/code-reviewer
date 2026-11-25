import { deepStrictEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { selectTests } from './select.mts'

const trace = (name: string, source: string) => ({
  test: name,
  fixtures: ['fixtures/catalog.json'],
  source,
})

test('a test that reads an unrelated pointer is dropped', () => {
  const traces = [trace('price.test', "loadFixture('/plans/pro/price')")]
  deepStrictEqual(selectTests('fixtures/catalog.json', ['/plans/free/seats'], traces), [])
})

test('a test that reads an overlapping pointer is kept', () => {
  const traces = [trace('price.test', "loadFixture('/plans/pro/price')")]
  deepStrictEqual(selectTests('fixtures/catalog.json', ['/plans/pro'], traces), ['price.test'])
})

test('a call with a variable pointer voids the proof, so the test is kept', () => {
  const traces = [trace('dynamic.test', 'loadFixture(id).size')]
  deepStrictEqual(selectTests('fixtures/catalog.json', ['/plans/free/seats'], traces), [
    'dynamic.test',
  ])
})

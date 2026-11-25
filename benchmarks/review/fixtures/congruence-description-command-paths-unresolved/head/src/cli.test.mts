import { strictEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { resolveConfig, run } from './cli.mts'

test('a relative config is joined to the root', () => {
  strictEqual(resolveConfig('examples/site', 'strict.json'), 'examples/site/strict.json')
})

test('run counts the rules of the named config', () => {
  strictEqual(run({ root: 'examples/site', config: 'strict.json' }), 'rules: 2')
})

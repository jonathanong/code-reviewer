import { deepStrictEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { lintFile } from './lint.mts'

const config = { allow: ['src/vendor/'] }

test('a banned import is reported', () => {
  deepStrictEqual(lintFile('src/app.mts', "import 'legacy-http'", config, new Set()), [
    'src/app.mts: imports legacy-http',
  ])
})

test('an allowed path is skipped and its entry is marked used', () => {
  const used = new Set<string>()
  deepStrictEqual(lintFile('src/vendor/a.mts', "import 'legacy-http'", config, used), [])
  deepStrictEqual([...used], ['src/vendor/'])
})

test('generated files are not linted', () => {
  deepStrictEqual(lintFile('src/generated/api.mts', "import 'legacy-http'", config, new Set()), [])
})

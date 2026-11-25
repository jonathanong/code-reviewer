import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { checkWorkflowEnv } from '../scripts/check-workflow-env.mjs'

function workflow(text) {
  const file = join(mkdtempSync(join(tmpdir(), 'wf-')), 'ci.yml')
  writeFileSync(file, text)
  return file
}

const step = (value) =>
  `jobs:\n  t:\n    steps:\n      - run: x\n        env:\n          NODE_ENV: ${value}\n`

it('reports a literal development value', () => {
  expect(checkWorkflowEnv(workflow(step('development')))).toHaveLength(1)
})

it('passes a literal production value', () => {
  expect(checkWorkflowEnv(workflow(step('production')))).toEqual([])
})

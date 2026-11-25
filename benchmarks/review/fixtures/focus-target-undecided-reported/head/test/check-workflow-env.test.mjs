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

it('reports an expression as could-not-analyse', () => {
  const [problem] = checkWorkflowEnv(workflow(step('${{ vars.MODE }}')))
  expect(problem.kind).toBe('could-not-analyse')
})

it('reports a missing file and a parse failure as could-not-analyse', () => {
  expect(checkWorkflowEnv('/nonexistent/ci.yml')[0].kind).toBe('could-not-analyse')
  expect(checkWorkflowEnv(workflow('jobs: [unclosed'))[0].kind).toBe('could-not-analyse')
})

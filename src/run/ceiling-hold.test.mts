import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../cli/command-review.mts', () => ({ reviewCommand: vi.fn() }))

import { reviewCommand } from '../cli/command-review.mts'
import { readFailures } from '../tracker/failures.mts'
import { foldRows, readRows } from '../tracker/store.mts'
import { PULL, runWith, setup, type Fake } from './harness.mts'
import type { RunLine } from './output.mts'

const STOPPED =
  'cost ceiling reached ($4.20 of $4.00): pillar.security did not start, so no review was produced'

let root: string
let stdout: string[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'run-ceiling-'))
  mkdirSync(join(root, 'tmp'))
  stdout = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.mocked(reviewCommand).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

async function run(fake: Fake, values = PULL) {
  const { code, lines } = await runWith(fake, stdout, values)
  expect(lines).toHaveLength(1)
  return { code, line: lines[0] as RunLine }
}

const stopped = () => setup(root, {}, { ok: false, error: STOPPED, ceilingCostUsd: 4.2 })

describe('runCommand when the cost ceiling stops the review', () => {
  it('holds the pull request for a human, posts nothing and keeps the spend', async () => {
    const fake = stopped()
    const { code, line } = await run(fake)
    expect(code).toBe(10)
    expect(line).toMatchObject({
      outcome: 'held',
      exitCode: 10,
      held: ['cost-ceiling'],
      reason: STOPPED,
      costUsd: 4.2,
      postCommand: null,
      explainPath: null,
    })
    expect(line.attention).toEqual([STOPPED])
    expect(fake.io.postReview).not.toHaveBeenCalled()
    expect(fake.labels).toEqual(['final-review:held'])
  })

  it('records the cost on the tracker row and no harness failure', async () => {
    const fake = stopped()
    await run(fake)
    const rows = foldRows(readRows(fake.deps.tracker()).rows)
    expect(rows).toEqual([
      expect.objectContaining({ state: 'failed', costUsd: 4.2, reason: STOPPED }),
    ])
    expect(readFailures(fake.deps.tracker())).toEqual([])
  })

  it('does not review the same head again at the same cost, unless forced', async () => {
    const fake = stopped()
    await run(fake)
    stdout.length = 0
    const again = await run(fake)
    expect(again.code).toBe(11)
    expect(again.line.reason).toContain('cost ceiling reached ($4.20 of $4.00)')
    expect(vi.mocked(reviewCommand)).toHaveBeenCalledOnce()
    stdout.length = 0
    expect((await run(fake, { ...PULL, force: true })).code).toBe(10)
    expect(vi.mocked(reviewCommand)).toHaveBeenCalledTimes(2)
  })

  it('is still an ordinary failure for a review that failed for another reason', async () => {
    const fake = setup(root, {}, { ok: false, error: 'every pillar failed' })
    const { code, line } = await run(fake)
    expect(code).toBe(13)
    expect(line.held).toEqual([])
  })
})

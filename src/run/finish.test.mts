import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeDeps } from './fake-deps.mts'
import { stageRun } from './fixture-run.mts'
import { postText, release, writeExplain } from './finish.mts'

const PULL = { repo: 'acme/widgets', pr: 4 }
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'run-finish-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('postText', () => {
  it('names the post command with the run directory unquoted when it is plain', () => {
    expect(postText(PULL, 'a'.repeat(40), '/runs/x')).toBe(
      `code-reviewer post --repo acme/widgets --pr 4 --head-sha ${'a'.repeat(40)} --input /runs/x/review.json`,
    )
  })

  it('quotes a run directory a shell would split, including a quote in it', () => {
    expect(postText(PULL, 'b'.repeat(40), "/my runs/it's")).toContain(
      "--input '/my runs/it'\\''s/review.json'",
    )
  })
})

describe('release', () => {
  it('reports nothing when the labels change', async () => {
    const fake = fakeDeps({ stateDir: root, labels: ['final-review:in-progress'] })
    await expect(release(PULL, fake.deps, 'hold')).resolves.toBeUndefined()
    expect(fake.labels).toEqual(['final-review:held'])
  })

  it('reports a problem, for an error or for something else thrown', async () => {
    const fake = fakeDeps({ stateDir: root, labels: ['final-review:in-progress'] })
    fake.labelIo.labels.mockRejectedValueOnce(new Error('labels are down'))
    await expect(release(PULL, fake.deps, 'drop')).resolves.toBe(
      'could not release the claim: labels are down',
    )
    fake.labelIo.labels.mockRejectedValueOnce('gone')
    await expect(release(PULL, fake.deps, 'drop')).resolves.toBe(
      'could not release the claim: gone',
    )
  })
})

describe('writeExplain', () => {
  it('writes explain.md in the run directory', () => {
    const fake = fakeDeps({ stateDir: root })
    stageRun(root)
    const written = writeExplain(fake.deps, root)
    expect(written).toEqual({ path: join(root, 'explain.md') })
    expect(readFileSync(join(root, 'explain.md'), 'utf8')).not.toBe('')
  })

  it('reports a problem when the explainer cannot be written, for any thrown value', () => {
    const fake = fakeDeps({ stateDir: root })
    expect(writeExplain(fake.deps, join(root, 'missing', 'dir')).problem).toContain(
      'could not write the explainer',
    )
    fake.deps.tracker.mockImplementation(() => {
      throw 'broken'
    })
    expect(writeExplain(fake.deps, root)).toEqual({
      path: null,
      problem: 'could not write the explainer: broken',
    })
    expect(vi.isMockFunction(fake.deps.tracker)).toBe(true)
  })
})

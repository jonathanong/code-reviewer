import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { cloneCandidates, productionSources, sharedFromClones } from './sources.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function clones(repos: string[], plain: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'clones-'))
  dirs.push(root)
  for (const repo of repos) mkdirSync(join(root, repo, '.git'), { recursive: true })
  for (const dir of plain) mkdirSync(join(root, dir), { recursive: true })
  return root
}

const git = vi.fn(async (args: string[]) => (args.includes('--abbrev-ref') ? 'origin/trunk\n' : ''))

describe('sharedFromClones', () => {
  it('reads each existing clone at its default branch and lists the missing ones', async () => {
    const root = clones(['no-mistakes'])
    const { shared, missing } = await sharedFromClones(root, git)
    expect(shared.map((item) => item.source.name)).toEqual(['no-mistakes-rules'])
    expect(shared[0]?.refLabel).toBe('default branch origin/trunk')
    expect(shared[0]?.reader.label).toBe('origin/trunk')
    expect(missing).toEqual([
      `vouchington-tooling: no clone at ${join(root, 'vouchington-tooling')}`,
    ])
  })

  it('lists everything as missing without a clone root', async () => {
    const { shared, missing } = await sharedFromClones(undefined, git)
    expect(shared).toEqual([])
    expect(missing).toHaveLength(2)
    expect(missing[0]).toContain('FINAL_REVIEWER_CLONE_ROOT')
  })
})

describe('cloneCandidates', () => {
  it('returns git clones except the pull request repo, sorted, with a code hint', async () => {
    const root = clones(['b-lib', 'a-lib', 'self'], ['not-a-repo'])
    const candidates = await cloneCandidates(root, git, 'self')
    expect(candidates.map((item) => item.name)).toEqual(['a-lib', 'b-lib'])
    expect(candidates[0]).toMatchObject({
      refLabel: 'default branch origin/trunk',
      stageCode: false,
      codeHint: `clone ${join(root, 'a-lib')}; read code with git -C ${join(root, 'a-lib')} show origin/trunk:<path> (the working tree may be on another branch)`,
    })
  })
})

describe('productionSources', () => {
  it('reads the base of the tree and the clones', async () => {
    const root = clones(['no-mistakes', 'vouchington-tooling', 'dep'])
    const sources = await productionSources({
      git,
      clones: root,
      tree: '/tree',
      baseSha: 'abcdef0123456789',
      repoName: 'self',
    })
    expect(sources.repo?.refLabel).toBe('base abcdef0')
    expect(sources.repo?.reader.label).toBe('abcdef0123456789')
    expect(sources.shared).toHaveLength(2)
    expect(sources.related.map((item) => item.name)).toEqual([
      'dep',
      'no-mistakes',
      'vouchington-tooling',
    ])
    expect(sources.missing).toEqual([])
  })

  it('skips shared and related without clones and the repo without a tree', async () => {
    const sources = await productionSources({
      git,
      clones: undefined,
      tree: undefined,
      baseSha: 'a'.repeat(40),
      repoName: 'self',
    })
    expect(sources.repo).toBeUndefined()
    expect(sources.shared).toEqual([])
    expect(sources.related).toEqual([])
    expect(sources.missing).toHaveLength(3)
    expect(sources.missing.at(-1)).toContain('dependencies: skipped')
  })
})

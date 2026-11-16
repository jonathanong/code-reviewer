import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { cloneCandidates, originRepo, productionSources, sharedFromClones } from './sources.mts'

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
    expect(missing).toEqual([`skills: no clone at ${join(root, 'skills')}`])
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
    const candidates = await cloneCandidates(root, git, 'acme/self')
    expect(candidates.map((item) => item.name)).toEqual(['a-lib', 'b-lib'])
    expect(candidates[0]).toMatchObject({
      refLabel: 'default branch origin/trunk',
      stageCode: false,
      codeHint: `clone ${join(root, 'a-lib')}; read code with git -C ${join(root, 'a-lib')} show origin/trunk:<path> (the working tree may be on another branch)`,
    })
  })
})

describe('clone identity', () => {
  const origins = (urls: Record<string, string>) =>
    vi.fn(async (args: string[]) => {
      if (args.includes('get-url')) {
        const url = urls[(args[1] as string).split('/').at(-1) as string]
        if (url === undefined) throw new Error('no origin')
        return `${url}\n`
      }
      return args.includes('--abbrev-ref') ? 'origin/main\n' : ''
    })

  it('parses https and ssh origins and gives up on anything else', async () => {
    const run = origins({
      a: 'https://github.com/Acme/a.git',
      b: 'git@github.com:acme/b.x',
      c: 'nonsense',
    })
    expect(await originRepo('/r/a', run)).toBe('Acme/a')
    expect(await originRepo('/r/b', run)).toBe('acme/b.x')
    expect(await originRepo('/r/c', run)).toBeUndefined()
    expect(await originRepo('/r/d', run)).toBeUndefined()
  })

  it('excludes the pull request repo by origin, not by directory name', async () => {
    const root = clones(['renamed', 'self', 'plain'])
    const run = origins({
      renamed: 'https://github.com/acme/Self',
      self: 'https://github.com/other/self.git',
    })
    const candidates = await cloneCandidates(root, run, 'Acme/self')
    expect(candidates.map((item) => [item.name, item.repo])).toEqual([
      ['plain', undefined],
      ['self', 'other/self'],
    ])
  })
})

describe('productionSources', () => {
  it('reads the base of the tree and the clones', async () => {
    const root = clones(['no-mistakes', 'skills', 'dep'])
    const sources = await productionSources({
      git,
      clones: root,
      tree: '/tree',
      baseSha: 'abcdef0123456789',
      repoId: 'acme/self',
      configDir: '/nowhere/configs',
    })
    expect(sources.repo?.refLabel).toBe('base abcdef0')
    expect(sources.repoId).toBe('acme/self')
    expect(sources.repo?.reader.label).toBe('abcdef0123456789')
    expect(sources.shared).toHaveLength(2)
    expect(sources.related.map((item) => item.name)).toEqual(['dep', 'no-mistakes', 'skills'])
    expect(sources.missing).toEqual([])
  })

  it('skips shared and related without clones and the repo without a tree', async () => {
    const sources = await productionSources({
      git,
      clones: undefined,
      tree: undefined,
      baseSha: 'a'.repeat(40),
      repoId: 'acme/self',
      configDir: '/nowhere/configs',
    })
    expect(sources.repo).toBeUndefined()
    expect(sources.repoId).toBe('acme/self')
    expect(sources.shared).toEqual([])
    expect(sources.related).toEqual([])
    expect(sources.missing).toHaveLength(3)
    expect(sources.missing.at(-1)).toContain('dependencies: skipped')
  })

  it('loads the configs and reports their problems as missing', async () => {
    const dir = clones([], ['acme'])
    writeFileSync(join(dir, 'acme/web.json'), '{"consumes":[{"repo":"acme/api"}],"x":1}')
    const sources = await productionSources({
      git,
      clones: undefined,
      tree: undefined,
      baseSha: 'a'.repeat(40),
      repoId: 'acme/self',
      configDir: dir,
    })
    expect(sources.configs?.byRepo.get('acme/web')?.consumes).toHaveLength(1)
    expect(sources.missing).toContain('acme/web.json: unknown key "x" ignored')
  })
})

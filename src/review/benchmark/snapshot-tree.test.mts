import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultExec } from './exec.mts'
import { buildTree } from './snapshot-tree.mts'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'snapshot-tree-test-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const GIT_IDENTITY = [
  '-c',
  'user.name=t',
  '-c',
  'user.email=t@example.test',
  '-c',
  'commit.gpgsign=false',
]

async function git(dir: string, ...args: string[]): Promise<string> {
  return (await defaultExec('git', ['-C', dir, ...args])).trim()
}

/** A source repository with a base commit, a head commit, and one commit after the head. */
async function sourceRepo(): Promise<{ src: string; base: string; head: string; later: string }> {
  const src = join(root, 'src')
  mkdirSync(src)
  await defaultExec('git', ['init', '--quiet', src])
  const commit = async (file: string): Promise<string> => {
    writeFileSync(join(src, file), file)
    await git(src, 'add', file)
    await git(src, ...GIT_IDENTITY, 'commit', '--quiet', '-m', file)
    return git(src, 'rev-parse', 'HEAD')
  }
  const base = await commit('base.txt')
  const head = await commit('head.txt')
  const later = await commit('revert.txt')
  return { src, base, head, later }
}

describe('buildTree', () => {
  it('checks out the head with its history and the base ref, and nothing later', async () => {
    const { src, base, head, later } = await sourceRepo()
    const cache = join(root, 'cache.git')
    await defaultExec('git', ['init', '--quiet', '--bare', cache])
    await git(cache, 'fetch', '--quiet', src, base, head)
    const dir = join(root, 'tree')
    await buildTree(dir, cache, { baseBranch: 'trunk', baseSha: base, headSha: head }, defaultExec)
    writeFileSync(join(dir, 'notes.txt'), 'untracked')
    mkdirSync(join(dir, '.review'))
    writeFileSync(join(dir, '.review', 'pr.md'), 'context')

    expect(await git(dir, 'rev-parse', 'HEAD')).toBe(head)
    expect(await git(dir, 'rev-list', 'HEAD')).toBe(`${head}\n${base}`)
    expect(await git(dir, 'rev-parse', 'origin/trunk')).toBe(base)
    expect(await git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD')).toBe(
      'refs/remotes/origin/trunk',
    )
    expect(await git(dir, 'merge-base', 'origin/trunk', 'HEAD')).toBe(base)
    expect(await git(dir, 'diff', '--name-only', 'origin/trunk...HEAD')).toBe('head.txt')
    expect(await git(dir, 'log', '--format=%H', 'origin/trunk..HEAD')).toBe(head)
    expect(await git(dir, 'remote')).toBe('')
    expect(await git(dir, 'status', '--porcelain')).toBe('?? notes.txt')
    expect(await git(dir, 'for-each-ref', '--format=%(refname)')).toBe(
      'refs/remotes/origin/HEAD\nrefs/remotes/origin/trunk',
    )
    await expect(git(dir, 'symbolic-ref', '--quiet', 'HEAD')).rejects.toThrow()
    await expect(git(dir, 'cat-file', '-e', later)).rejects.toThrow()
    await expect(git(dir, 'log', '--all', '--format=%H', '--', 'revert.txt')).resolves.toBe('')
  })
})

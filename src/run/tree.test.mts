import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runGit } from '../gh-cli/index.mts'
import { checkoutHead, findClone } from './tree.mts'

let root: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  ).trim()
}

/** An origin at `<root>/origin/acme/widgets` (so its URL names acme/widgets) with one commit. */
function makeOrigin(): { origin: string; head: string } {
  const origin = join(root, 'origin', 'acme', 'widgets')
  mkdirSync(origin, { recursive: true })
  git(origin, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(origin, 'file.txt'), 'first\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '--quiet', '-m', 'first')
  return { origin, head: git(origin, 'rev-parse', 'HEAD') }
}

function pushSecondCommit(origin: string): string {
  writeFileSync(join(origin, 'file.txt'), 'second\n')
  git(origin, 'commit', '--quiet', '-am', 'second')
  return git(origin, 'rev-parse', 'HEAD')
}

const args = (clones: string | undefined, origin: string, headSha: string) => ({
  repo: 'acme/widgets',
  headSha,
  clones,
  git: runGit,
  tmp: join(root, 'tmp'),
  remote: () => origin,
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'run-tree-'))
  mkdirSync(join(root, 'tmp'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('findClone', () => {
  it('matches a clone by its origin, whatever its directory is called, and skips non-clones', async () => {
    const { origin } = makeOrigin()
    const clones = join(root, 'clones')
    mkdirSync(join(clones, 'not-a-repo'), { recursive: true })
    git(root, 'clone', '--quiet', origin, join(clones, 'renamed'))
    await expect(findClone(clones, 'Acme/Widgets', runGit)).resolves.toBe(join(clones, 'renamed'))
  })

  it('matches a clone without an origin by its directory name', async () => {
    const clones = join(root, 'clones')
    mkdirSync(join(clones, 'widgets'), { recursive: true })
    git(join(clones, 'widgets'), 'init', '--quiet')
    await expect(findClone(clones, 'acme/widgets', runGit)).resolves.toBe(join(clones, 'widgets'))
  })

  it('finds nothing when no clone is this repository', async () => {
    const clones = join(root, 'clones')
    mkdirSync(join(clones, 'other'), { recursive: true })
    git(join(clones, 'other'), 'init', '--quiet')
    await expect(findClone(clones, 'acme/widgets', runGit)).resolves.toBeUndefined()
  })
})

describe('checkoutHead', () => {
  it('adds a worktree of the local clone at the fetched head and removes it', async () => {
    const { origin } = makeOrigin()
    const clones = join(root, 'clones')
    git(root, 'clone', '--quiet', origin, join(clones, 'widgets'))
    const head = pushSecondCommit(origin)
    const tree = await checkoutHead(args(clones, origin, head))
    expect(tree.kind).toBe('worktree')
    expect(tree.path.startsWith(join(root, 'tmp'))).toBe(true)
    expect(readFileSync(join(tree.path, 'file.txt'), 'utf8')).toBe('second\n')
    expect(git(tree.path, 'rev-parse', 'HEAD')).toBe(head)
    await tree.remove()
    expect(existsSync(tree.path)).toBe(false)
    expect(readdirSync(join(root, 'tmp'))).toEqual([])
    expect(git(join(clones, 'widgets'), 'worktree', 'list', '--porcelain')).not.toContain(tree.path)
  })

  it('reports a removal that git refuses and still deletes the directory', async () => {
    const { origin, head } = makeOrigin()
    const clones = join(root, 'clones')
    git(root, 'clone', '--quiet', origin, join(clones, 'widgets'))
    const tree = await checkoutHead(args(clones, origin, head))
    await tree.remove()
    await expect(tree.remove()).rejects.toThrow()
    expect(readdirSync(join(root, 'tmp'))).toEqual([])
  })

  it('clones blobless when no clone root is set, and again when it holds no such clone', async () => {
    const { origin, head } = makeOrigin()
    const first = await checkoutHead(args(undefined, origin, head))
    expect(first.kind).toBe('clone')
    expect(readFileSync(join(first.path, 'file.txt'), 'utf8')).toBe('first\n')
    await first.remove()
    const second = await checkoutHead(args(join(root, 'missing'), origin, head))
    expect(second.kind).toBe('clone')
    await second.remove()
    expect(readdirSync(join(root, 'tmp'))).toEqual([])
  })

  it('clones when the clone root holds no clone of this repository', async () => {
    const { origin, head } = makeOrigin()
    const clones = join(root, 'clones')
    mkdirSync(clones)
    const tree = await checkoutHead(args(clones, origin, head))
    expect(tree.kind).toBe('clone')
    await tree.remove()
  })

  it('leaves nothing behind when the head cannot be fetched', async () => {
    const { origin } = makeOrigin()
    await expect(checkoutHead(args(undefined, origin, 'f'.repeat(40)))).rejects.toThrow()
    expect(readdirSync(join(root, 'tmp'))).toEqual([])
  })
})

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultRef, dirReader, gitReader } from './reader.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tree(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'reader-'))
  dirs.push(root)
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), `text of ${file}`)
  }
  return root
}

describe('dirReader', () => {
  it('lists files, skipping vendored and generated directories', async () => {
    const root = tree([
      'AGENTS.md',
      'src/a.ts',
      'node_modules/x/index.js',
      '.git/config',
      '.claude/worktrees/w/a.ts',
      'target/debug/x',
      'coverage/lcov.info',
      '.final-review/rules/INDEX.md',
      '.claude/skills/s/SKILL.md',
    ])
    const reader = dirReader(root, 'base')
    expect(reader.label).toBe('base')
    expect(await reader.list()).toEqual(['.claude/skills/s/SKILL.md', 'AGENTS.md', 'src/a.ts'])
  })

  it('reads text and returns undefined for a missing file', async () => {
    const reader = dirReader(tree(['a.md']))
    expect(reader.label).toBe('dir')
    expect(await reader.read('a.md')).toBe('text of a.md')
    expect(await reader.read('b.md')).toBeUndefined()
  })
})

describe('gitReader', () => {
  it('lists with ls-tree and reads with show at the ref', async () => {
    const git = vi.fn(async (args: string[]) =>
      args.includes('ls-tree') ? 'a.md\nb/c.md\n' : 'body',
    )
    const reader = gitReader('/repo', 'origin/main', git)
    expect(reader.label).toBe('origin/main')
    expect(await reader.list()).toEqual(['a.md', 'b/c.md'])
    expect(await reader.read('a.md')).toBe('body')
    expect(git).toHaveBeenCalledWith(['-C', '/repo', 'ls-tree', '-r', '--name-only', 'origin/main'])
    expect(git).toHaveBeenCalledWith(['-C', '/repo', 'show', 'origin/main:a.md'])
  })

  it('returns undefined when show fails and honors a label', async () => {
    const reader = gitReader('/repo', 'abc', () => Promise.reject(new Error('no')), 'base abc')
    expect(reader.label).toBe('base abc')
    expect(await reader.read('x')).toBeUndefined()
  })
})

describe('defaultRef', () => {
  it('uses origin/HEAD when set', async () => {
    expect(await defaultRef('/r', async () => 'origin/master\n')).toBe('origin/master')
  })

  it('falls back to origin/main, then HEAD', async () => {
    const noHead = async (args: string[]) => {
      if (args.includes('--abbrev-ref')) throw new Error('no head')
      return ''
    }
    expect(await defaultRef('/r', noHead)).toBe('origin/main')
    // An unresolved origin/HEAD echoes itself back.
    expect(
      await defaultRef('/r', async (args) =>
        args.includes('--abbrev-ref') ? 'origin/HEAD\n' : '',
      ),
    ).toBe('origin/main')
    expect(
      await defaultRef('/r', async (args) => {
        throw new Error(args.join(' '))
      }),
    ).toBe('HEAD')
  })
})

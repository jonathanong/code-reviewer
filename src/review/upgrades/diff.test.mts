import { describe, expect, it, vi } from 'vitest'

import { runGit } from '../../gh-cli/index.mts'
import { diffPackages } from './diff.mts'
import { createUpgradeIo } from './io.mts'
import type { PackageFiles } from './tarball.mts'

const files = (spec: Record<string, string | Buffer>): PackageFiles =>
  new Map(Object.entries(spec).map(([path, body]) => [path, Buffer.from(body)]))

const { diffDirs } = createUpgradeIo(runGit)

describe('diffPackages with git', () => {
  it('diffs the changed files, package.json first, then declarations, then code', async () => {
    const before = files({
      'dist/index.js': 'export const a = 1\n',
      'dist/index.d.ts': 'export declare const a: number\n',
      'package.json': '{"version":"0.7.1"}\n',
      'same.js': 'same\n',
    })
    const after = files({
      'dist/index.js': 'export const b = 1\n',
      'dist/index.d.ts': 'export declare const b: number\n',
      'package.json': '{"version":"0.8.0"}\n',
      'same.js': 'same\n',
      'added.js': 'new file\n',
    })
    const { text, notes } = await diffPackages(before, after, diffDirs)
    const order = [...text.matchAll(/^diff --git a\/(?:old|new)\/(\S+)/gmu)].map((m) => m[1])
    expect(order).toEqual(['package.json', 'dist/index.d.ts', 'added.js', 'dist/index.js'])
    expect(text).toContain('-export declare const a: number')
    expect(text).toContain('+export declare const b: number')
    expect(text).not.toContain('same.js')
    expect(notes).toEqual([])
  })

  it('names source maps, binaries and large files instead of diffing them', async () => {
    const before = files({ 'a.js': '1\n', 'a.js.map': '{}', 'logo.png': Buffer.from([0, 1, 2]) })
    const after = files({
      'a.js': '2\n',
      'a.js.map': '{"x":1}',
      'logo.png': Buffer.from([0, 9]),
      'big.js': 'x'.repeat(300 * 1024),
    })
    const { text, notes } = await diffPackages(before, after, diffDirs)
    expect(text).toContain('+2')
    expect(text).not.toContain('logo.png')
    expect(text).not.toContain('big.js')
    expect(notes).toEqual([
      '3 changed files are not diffed: a.js.map (source map), big.js (over 256 KB), logo.png (binary).',
    ])
  })

  it('lists at most ten of the files it leaves out', async () => {
    const maps = (body: string) =>
      files(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`m${i}.map`, body])))
    const { notes } = await diffPackages(maps('1'), maps('2'), diffDirs)
    expect(notes[0]).toMatch(/^12 changed files are not diffed: .*, \.\.\.\.$/u)
  })

  it('cuts the patch at a line, keeps the order, and states the cut', async () => {
    const lines = (word: string) => Array.from({ length: 100 }, (_, i) => `${word} ${i}`).join('\n')
    const before = files({ 'a.js': lines('old'), 'b.js': lines('older') })
    const after = files({ 'a.js': lines('new'), 'b.js': lines('newer') })
    const { text, notes } = await diffPackages(before, after, diffDirs, 3000)
    expect(text.length).toBeLessThanOrEqual(3000)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('diff --git a/old/a.js')
    expect(notes).toEqual([
      'The diff is cut at 3000 characters; 1 of 2 changed files are partly or wholly missing.',
    ])
  })

  it('gives no text when only unreadable files differ or nothing differs', async () => {
    const same = files({ 'a.js': '1\n' })
    expect(await diffPackages(same, same, diffDirs)).toEqual({ text: '', notes: [] })
    const maps = await diffPackages(files({ 'a.map': '1' }), files({ 'a.map': '2' }), diffDirs)
    expect(maps.text).toBe('')
    expect(maps.notes).toHaveLength(1)
  })

  it('never writes a path outside its own directory', async () => {
    const seen = vi.fn(async () => '')
    await diffPackages(
      files({ '../escape.js': '1' }),
      files({ '../escape.js': '2', 'ok.js': '3' }),
      seen,
    )
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('lets a failing diff reject, after removing its temporary files', async () => {
    const failing = vi.fn(async () => {
      throw new Error('git is gone')
    })
    await expect(
      diffPackages(files({ 'a.js': '1' }), files({ 'a.js': '2' }), failing),
    ).rejects.toThrow('git is gone')
  })
})

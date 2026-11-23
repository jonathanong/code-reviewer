import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareDocs } from './docs-prepare.mts'
import { fakeIo } from './prepare-fake-io.mts'
import { prepareReview } from './prepare.mts'

const PATHS = ['src/follow-context.mts', 'a.ts']
const HIT = 'docs/guide.md\0 12\0Follow context is shown on every topic.\n'

let out = ''
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'docs-prepare-'))
})
afterEach(() => {
  rmSync(out, { recursive: true, force: true })
})

describe('prepareDocs', () => {
  it('searches the tree and writes docs.md when a line mentions a changed name', async () => {
    const io = fakeIo()
    io.docGrep.mockResolvedValue(HIT)
    const write = vi.fn()
    const result = await prepareDocs(io, out, write, '/tree', PATHS)
    expect(result).toEqual({ written: ['docs.md'], problems: [] })
    expect(io.docGrep).toHaveBeenCalledTimes(1)
    expect(io.docGrep.mock.calls[0]?.[0]).toBe('/tree')
    expect(write).toHaveBeenCalledWith(
      join(out, 'docs.md'),
      expect.stringContaining('- `docs/guide.md:12`: Follow context is shown on every topic.'),
    )
  })

  it('writes nothing when the search found no line', async () => {
    const io = fakeIo()
    const write = vi.fn()
    expect(await prepareDocs(io, out, write, '/tree', PATHS)).toEqual({ written: [], problems: [] })
    expect(io.docGrep).toHaveBeenCalledTimes(1)
    expect(write).not.toHaveBeenCalled()
  })

  it('does not search without a checkout', async () => {
    const io = fakeIo()
    const write = vi.fn()
    expect(await prepareDocs(io, out, write, undefined, PATHS)).toEqual({
      written: [],
      problems: [],
    })
    expect(io.docGrep).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('leaves out the run directory when it lies inside the tree, and only then', async () => {
    const inside = fakeIo()
    await prepareDocs(inside, join('/tree', '.run'), vi.fn(), '/tree', PATHS)
    expect(inside.docGrep.mock.calls[0]?.[1].at(-1)).toBe(':(exclude).run')
    for (const elsewhere of ['/elsewhere/run', '/tree']) {
      const io = fakeIo()
      await prepareDocs(io, elsewhere, vi.fn(), '/tree', PATHS)
      expect(io.docGrep.mock.calls[0]?.[1].some((arg) => arg.startsWith(':(exclude)'))).toBe(false)
    }
  })

  it('records a failed search as a problem instead of failing the review', async () => {
    const io = fakeIo()
    io.docGrep.mockRejectedValue(new Error('fatal: not a git repository'))
    const write = vi.fn()
    const result = await prepareDocs(io, out, write, '/tree', PATHS)
    expect(result.written).toEqual([])
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toContain('not a git repository')
    expect(write).not.toHaveBeenCalled()
    io.docGrep.mockRejectedValue('odd')
    expect((await prepareDocs(io, out, write, '/tree', PATHS)).problems[0]).toContain('odd')
  })
})

describe('prepareReview and the documentation search', () => {
  it('writes docs.md into the run directory, lists it, and removes a stale one without a hit', async () => {
    const io = fakeIo({ paths: PATHS })
    io.docGrep.mockResolvedValue(HIT)
    const summary = await prepareReview(io, { out, tree: '/tree' })
    expect(summary.written).toContain('docs.md')
    expect(readFileSync(join(out, 'docs.md'), 'utf8')).toContain('docs/guide.md:12')
    const quiet = fakeIo({ paths: PATHS })
    const again = await prepareReview(quiet, { out, tree: '/tree' })
    expect(again.written).not.toContain('docs.md')
    expect(existsSync(join(out, 'docs.md'))).toBe(false)
  })

  it('writes nothing without a tree, and does not fail on a failed search', async () => {
    mkdirSync(out, { recursive: true })
    const flat = fakeIo({ paths: PATHS })
    const summary = await prepareReview(flat, { out })
    expect(flat.docGrep).not.toHaveBeenCalled()
    expect(summary.written).not.toContain('docs.md')
    const failing = fakeIo({ paths: PATHS })
    failing.docGrep.mockRejectedValue(new Error('boom'))
    const result = await prepareReview(failing, { out, tree: '/tree' })
    expect(result.written).not.toContain('docs.md')
    expect(result.problems?.some((problem) => problem.includes('boom'))).toBe(true)
  })
})

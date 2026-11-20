import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CarriedInspection } from './carried-file.mts'
import { prepareCarried } from './carried-prepare.mts'
import type { PrepareIo } from './prepare-io.mts'
import type { StackFile } from './stack-file.mts'

const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const NONE: CarriedInspection = {
  commits: [],
  commitsInRange: 2,
  files: [],
  filesTotal: 0,
  defaultBranch: 'main',
  base: 'default',
  problems: [],
}
const ONE: CarriedInspection = {
  ...NONE,
  commits: [{ sha: 'c'.repeat(40), subject: 's', home: { kind: 'default' }, how: 'patch' }],
}

let out: string
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'carried-prepare-'))
})
afterEach(() => rmSync(out, { recursive: true, force: true }))

const member = (number: number, headSha: string) => ({
  number,
  title: `T${number}`,
  headRef: `h${number}`,
  baseRef: 'main',
  headSha,
})

function setup(inspection: CarriedInspection, merged?: number | Error) {
  const io = {
    carried: vi.fn(async () => inspection),
    mergedPull: vi.fn(async () => {
      if (merged instanceof Error) throw merged
      return merged
    }),
  }
  return { io, asIo: io as unknown as PrepareIo }
}
const args = { baseSha: BASE, headSha: HEAD, baseRef: 'parent' }

describe('prepareCarried', () => {
  it('claims nothing without a checkout', async () => {
    const { io, asIo } = setup(ONE)
    expect(await prepareCarried(asIo, out, vi.fn(), args)).toEqual({ problems: [] })
    expect(io.carried).not.toHaveBeenCalled()
  })

  it('writes nothing when nothing is carried and the base is the default branch', async () => {
    const { io, asIo } = setup(NONE)
    const write = vi.fn()
    const result = await prepareCarried(asIo, out, write, { ...args, tree: '/t' })
    expect(result).toEqual({ problems: [] })
    expect(io.mergedPull).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('writes carried.json for carried commits and asks nothing about a base that is still open', async () => {
    const { io, asIo } = setup({ ...ONE, base: 'present' })
    const result = await prepareCarried(
      asIo,
      out,
      (path, text) => {
        expect(path).toBe(join(out, 'carried.json'))
        expect(JSON.parse(text).baseRef).toBe('parent')
      },
      { ...args, tree: '/t' },
    )
    expect(result.file?.commits).toHaveLength(1)
    expect(io.mergedPull).toHaveBeenCalledWith('parent')
    expect(result.file?.baseMergedIn).toBeUndefined()
  })

  it('records the pull request that merged the base branch', async () => {
    const { asIo } = setup({ ...NONE, base: 'present' }, 12)
    const result = await prepareCarried(asIo, out, (_path, text) => void text, {
      ...args,
      tree: '/t',
    })
    expect(result.file).toMatchObject({ baseMergedIn: 12, baseRef: 'parent' })
  })

  it('records a base branch that is gone, and a lookup that fails as a problem', async () => {
    const { asIo } = setup({ ...NONE, base: 'missing' }, new Error('rate limited\nmore'))
    const result = await prepareCarried(asIo, out, () => undefined, { ...args, tree: '/t' })
    expect(result.file?.base).toBe('missing')
    expect(result.problems).toEqual([
      'Whether the base branch was merged could not be read: rate limited',
    ])
    expect(result.file?.problems).toEqual(result.problems)
  })

  it('reports a lookup that throws a non-error', async () => {
    const { io, asIo } = setup({ ...NONE, base: 'present' })
    io.mergedPull.mockRejectedValue('nope')
    const result = await prepareCarried(asIo, out, () => undefined, { ...args, tree: '/t' })
    expect(result.problems[0]).toContain('nope')
  })

  it('hands git the stack parents and the older open pull requests, newest first and capped', async () => {
    const stack: StackFile = {
      members: [member(3, 's3'), member(4, 's4'), member(5, 's5')],
      index: 2,
      defaultBranch: 'main',
      rootIsDefault: true,
    } as unknown as StackFile
    const pulls = [
      member(1, 'p1'),
      member(2, 'p2'),
      member(3, 's3'),
      member(5, HEAD),
      member(6, 'p6'),
      ...Array.from({ length: 25 }, (_, at) => member(100 + at, `x${at}`)),
    ]
    const { io, asIo } = setup(NONE)
    await prepareCarried(asIo, out, () => undefined, {
      ...args,
      tree: '/t',
      stack,
      open: { pr: 5, pulls },
    })
    expect(io.carried).toHaveBeenCalledWith('/t', {
      baseSha: BASE,
      headSha: HEAD,
      baseRef: 'parent',
      parents: [
        { number: 3, headSha: 's3' },
        { number: 4, headSha: 's4' },
      ],
      others: [
        { number: 2, headSha: 'p2' },
        { number: 1, headSha: 'p1' },
      ],
    })
  })

  it('compares no older pull request when the open list is unknown', async () => {
    const { io, asIo } = setup(NONE)
    await prepareCarried(asIo, out, () => undefined, { ...args, tree: '/t' })
    expect(io.carried).toHaveBeenCalledWith(
      '/t',
      expect.objectContaining({ parents: [], others: [] }),
    )
  })
})

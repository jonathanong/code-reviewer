import { describe, expect, it, vi } from 'vitest'

import { createUpgradeIo } from './io.mts'

describe('createUpgradeIo', () => {
  it('reads the merge base and a file at a commit with local git', async () => {
    const git = vi.fn(async (args: string[]) => (args.includes('merge-base') ? 'abc123\n' : 'text'))
    const io = createUpgradeIo(git)
    expect(await io.mergeBase('/tree', 'base', 'head')).toBe('abc123')
    expect(await io.fileAt('/tree', 'abc123', 'pnpm-lock.yaml')).toBe('text')
    expect(git).toHaveBeenLastCalledWith(['-C', '/tree', 'show', 'abc123:pnpm-lock.yaml'])
  })

  it('reads a file missing at a commit as undefined', async () => {
    const io = createUpgradeIo(async () => {
      throw new Error('fatal: path does not exist')
    })
    expect(await io.fileAt('/tree', 'abc', 'pnpm-lock.yaml')).toBeUndefined()
  })

  it('takes the patch of a diff that exits 1, and rethrows any other failure', async () => {
    const differ = createUpgradeIo(async () => {
      throw Object.assign(new Error('exit 1'), { code: 1, stdout: 'patch' })
    })
    expect(await differ.diffDirs('/tmp/x')).toBe('patch')
    const same = createUpgradeIo(async () => '')
    expect(await same.diffDirs('/tmp/x')).toBe('')
    for (const error of [
      Object.assign(new Error('boom'), { code: 128, stdout: 'x' }),
      Object.assign(new Error('no stdout'), { code: 1 }),
    ]) {
      const broken = createUpgradeIo(async () => {
        throw error
      })
      await expect(broken.diffDirs('/tmp/x')).rejects.toBe(error)
    }
  })

  it('uses the global fetch unless one is given', () => {
    expect(createUpgradeIo(async () => '').fetcher).toBe(fetch)
  })
})

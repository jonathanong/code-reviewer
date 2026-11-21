import { describe, expect, it, vi } from 'vitest'

import { evidenceHolds, pathsChangedBetween, type EvidenceStamp } from './evidence-scope.mts'

const SHA = 'a'.repeat(40)
const scoped = (...paths: string[]): EvidenceStamp => ({
  headSha: SHA,
  scope: { kind: 'paths', paths },
})

describe('evidenceHolds', () => {
  it('holds when the scope is known and no changed path is inside it', () => {
    expect(evidenceHolds(scoped('src/a.ts', 'docs/'), ['src/b.ts', 'README.md'])).toBe('holds')
    expect(evidenceHolds(scoped('src/a.ts'), [])).toBe('holds')
  })

  it('is stale when a changed path is a scoped file or inside a scoped directory', () => {
    expect(evidenceHolds(scoped('src/a.ts'), ['src/b.ts', 'src/a.ts'])).toBe('stale')
    expect(evidenceHolds(scoped('docs/'), ['docs/x/y.md'])).toBe('stale')
  })

  it('does not treat a sibling that shares a name prefix as inside the scope', () => {
    expect(evidenceHolds(scoped('src/a.ts'), ['src/a.tsx'])).toBe('holds')
    expect(evidenceHolds(scoped('docs/'), ['docs-old/x.md'])).toBe('holds')
  })

  it('is unknown for an unknown, empty or missing scope, and for a missing sha', () => {
    const none: string[] = []
    expect(evidenceHolds({ headSha: SHA, scope: { kind: 'unknown' } }, none)).toBe('unknown')
    expect(evidenceHolds(scoped(), none)).toBe('unknown')
    expect(evidenceHolds({ headSha: SHA }, none)).toBe('unknown')
    expect(evidenceHolds({ scope: { kind: 'paths', paths: ['a'] } }, none)).toBe('unknown')
    expect(evidenceHolds({}, ['a'])).toBe('unknown')
  })
})

describe('pathsChangedBetween', () => {
  it('lists the paths git reports between two commits, in the checkout', async () => {
    const exec = vi.fn(async () => 'a.ts\0dir/b ü.ts\0')
    await expect(pathsChangedBetween(exec, '/tree', 'old', 'new')).resolves.toEqual([
      'a.ts',
      'dir/b ü.ts',
    ])
    expect(exec).toHaveBeenCalledWith('git', [
      '-C',
      '/tree',
      'diff',
      '--name-only',
      '-z',
      'old..new',
    ])
  })

  it('returns an empty list for no change, and undefined when git fails', async () => {
    await expect(pathsChangedBetween(async () => '', '/t', 'a', 'b')).resolves.toEqual([])
    const failing = vi.fn(async () => {
      throw new Error('bad object')
    })
    await expect(pathsChangedBetween(failing, '/t', 'a', 'b')).resolves.toBeUndefined()
  })
})

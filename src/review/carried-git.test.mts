import { describe, expect, it } from 'vitest'

import { contentOnDefault } from './carried-git.mts'

/** A double that answers a file listing, or the comparison against the default branch. */
function fakeGit(listed: string[], differing: string[]) {
  return async (...args: string[]) => {
    const dashes = args.indexOf('--')
    return (dashes === -1 ? listed : differing).join('\n')
  }
}

describe('contentOnDefault', () => {
  it('is false when the commits change no files, or too many to compare', async () => {
    expect(await contentOnDefault(fakeGit([], []), 'origin/main', 'a', 'b')).toBe(false)
    const many = Array.from({ length: 201 }, (_, at) => `f${at}`)
    expect(await contentOnDefault(fakeGit(many, []), 'origin/main', 'a', 'b')).toBe(false)
  })

  it('is true only when none of the changed files differs on the default branch', async () => {
    expect(await contentOnDefault(fakeGit(['a.ts'], []), 'origin/main', 'a', 'b')).toBe(true)
    expect(await contentOnDefault(fakeGit(['a.ts'], ['a.ts']), 'origin/main', 'a', 'b')).toBe(false)
  })
})

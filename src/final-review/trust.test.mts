import { describe, expect, it, vi } from 'vitest'

import { isTrustedAuthor, parseTrustedAuthors, resolveTrustedAuthors } from './trust.mts'

describe('parseTrustedAuthors', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseTrustedAuthors(' a[bot] ,, B ,')).toEqual(['a[bot]', 'B'])
    expect(parseTrustedAuthors(undefined)).toEqual([])
  })
})

describe('isTrustedAuthor', () => {
  it('matches case-insensitively and rejects missing authors', () => {
    const trusted = new Set(['bot'])
    expect(isTrustedAuthor('Bot', trusted)).toBe(true)
    expect(isTrustedAuthor('eve', trusted)).toBe(false)
    expect(isTrustedAuthor(null, trusted)).toBe(false)
    expect(isTrustedAuthor(undefined, trusted)).toBe(false)
  })
})

describe('resolveTrustedAuthors', () => {
  it('adds the viewer to the allowlist', async () => {
    const run = vi.fn(async () => '{"data":{"viewer":{"login":"Me"}}}')
    await expect(resolveTrustedAuthors(run, ['App[bot]'])).resolves.toEqual(
      new Set(['app[bot]', 'me']),
    )
  })

  it('falls back to the allowlist when viewer is unavailable', async () => {
    const run = vi.fn(async () => {
      throw new Error('Resource not accessible by integration')
    })
    await expect(resolveTrustedAuthors(run, ['app[bot]'])).resolves.toEqual(new Set(['app[bot]']))
    await expect(resolveTrustedAuthors(run, [])).resolves.toEqual(new Set())
  })

  it('tolerates a response without a viewer', async () => {
    const run = vi.fn(async () => '{"data":{}}')
    await expect(resolveTrustedAuthors(run, [])).resolves.toEqual(new Set())
  })
})

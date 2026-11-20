import { describe, expect, it, vi } from 'vitest'

import { isTrustedAuthor, resolveTrustedAuthors } from './trust.mts'

describe('isTrustedAuthor', () => {
  it('ignores a trailing [bot] on either side', () => {
    expect(isTrustedAuthor('my-app', new Set(['my-app[bot]']))).toBe(true)
    expect(isTrustedAuthor('My-App[bot]', new Set(['my-app']))).toBe(true)
    expect(isTrustedAuthor('other', new Set(['my-app[bot]']))).toBe(false)
  })

  it('matches case-insensitively and rejects missing authors', () => {
    const trusted = new Set(['bot'])
    expect(isTrustedAuthor('Bot', trusted)).toBe(true)
    expect(isTrustedAuthor('eve', trusted)).toBe(false)
    expect(isTrustedAuthor(null, trusted)).toBe(false)
    expect(isTrustedAuthor(undefined, trusted)).toBe(false)
  })
})

describe('resolveTrustedAuthors', () => {
  const viewer = vi.fn(async () => '{"data":{"viewer":{"login":"Me"}}}')
  const noViewer = vi.fn(async () => {
    throw new Error('Resource not accessible by integration')
  })

  it('trusts the gh viewer', async () => {
    await expect(resolveTrustedAuthors(viewer, async () => undefined)).resolves.toEqual(
      new Set(['me']),
    )
  })

  it('trusts the App identity when the installation token has no viewer', async () => {
    await expect(resolveTrustedAuthors(noViewer, async () => 'My-App[bot]')).resolves.toEqual(
      new Set(['my-app[bot]']),
    )
  })

  it('trusts nobody when the identity lookup fails', async () => {
    const failed = async () => {
      throw new Error('GET /app failed')
    }
    await expect(resolveTrustedAuthors(noViewer, failed)).resolves.toEqual(new Set())
  })

  it('tolerates a response without a viewer', async () => {
    const run = vi.fn(async () => '{"data":{}}')
    await expect(resolveTrustedAuthors(run, async () => undefined)).resolves.toEqual(new Set())
  })
})

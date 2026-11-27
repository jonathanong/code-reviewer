import { describe, expect, it } from 'vitest'

import { fakeRegistry, integrityOf, tarball } from './registry-fake-io.mts'
import { fetchTarball, MAX_TARBALL_BYTES, tarballUrl, type Fetcher } from './registry.mts'

const SIGNAL = new AbortController().signal
const URL_OF = 'https://registry.npmjs.org/@atproto/oauth-types/-/oauth-types-0.8.0.tgz'

describe('tarballUrl', () => {
  it('builds the registry URL from a validated name and version', () => {
    expect(tarballUrl('@atproto/oauth-types', '0.8.0')).toBe(URL_OF)
    expect(tarballUrl('left-pad', '1.3.0-beta.1')).toBe(
      'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0-beta.1.tgz',
    )
  })

  it.each([
    ['a path in the name', '../../evil', '1.0.0'],
    ['a URL as the name', 'https://evil.example/x', '1.0.0'],
    ['a version that is a URL', 'left-pad', 'https://evil.example/x.tgz'],
    ['a version with a path', 'left-pad', '1.0.0/../../x'],
  ])('refuses %s', (_name, name, version) => {
    expect(() => tarballUrl(name, version)).toThrow('not a registry package version')
  })
})

describe('fetchTarball', () => {
  const bytes = tarball({ 'package.json': '{}' })

  it('returns the tarball, checked against the lockfile integrity', async () => {
    const { fetcher, asked } = fakeRegistry({ [URL_OF]: bytes })
    const got = await fetchTarball(
      fetcher,
      '@atproto/oauth-types',
      '0.8.0',
      integrityOf(bytes),
      SIGNAL,
    )
    expect(got.equals(bytes)).toBe(true)
    expect(asked).toEqual([URL_OF])
  })

  it('accepts a tarball when the lockfile has no integrity', async () => {
    const { fetcher } = fakeRegistry({ [URL_OF]: bytes })
    expect(
      (await fetchTarball(fetcher, '@atproto/oauth-types', '0.8.0', undefined, SIGNAL)).length,
    ).toBe(bytes.length)
  })

  it('rejects a tarball that is not the one the lockfile pins', async () => {
    const { fetcher } = fakeRegistry({ [URL_OF]: bytes })
    await expect(
      fetchTarball(fetcher, '@atproto/oauth-types', '0.8.0', 'sha512-other', SIGNAL),
    ).rejects.toThrow('does not match the lockfile integrity')
  })

  it.each([404, 503, 302])('rejects a %i answer, redirects included', async (status) => {
    const { fetcher } = fakeRegistry({ [URL_OF]: status })
    await expect(
      fetchTarball(fetcher, '@atproto/oauth-types', '0.8.0', undefined, SIGNAL),
    ).rejects.toThrow(`answered ${status}`)
  })

  it('rejects a tarball over the size limit, by its declared length and by what arrives', async () => {
    const declared: Fetcher = async () =>
      new Response('x', { headers: { 'content-length': String(MAX_TARBALL_BYTES + 1) } })
    const streamed: Fetcher = async () => new Response(new Uint8Array(MAX_TARBALL_BYTES + 1))
    for (const fetcher of [declared, streamed]) {
      await expect(fetchTarball(fetcher, 'left-pad', '1.0.0', undefined, SIGNAL)).rejects.toThrow(
        'over',
      )
    }
  })

  it('treats a body-less response as empty', async () => {
    const empty: Fetcher = async () => new Response(null, { status: 200 })
    expect((await fetchTarball(empty, 'left-pad', '1.0.0', undefined, SIGNAL)).length).toBe(0)
  })

  it('rejects when the registry is unreachable or the step was aborted', async () => {
    const down: Fetcher = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(fetchTarball(down, 'left-pad', '1.0.0', undefined, SIGNAL)).rejects.toThrow(
      'fetch failed',
    )
    const aborted = new AbortController()
    aborted.abort(new Error('step timed out'))
    const honours: Fetcher = async (_url, { signal }) => {
      signal.throwIfAborted()
      return new Response('x')
    }
    await expect(
      fetchTarball(honours, 'left-pad', '1.0.0', undefined, aborted.signal),
    ).rejects.toThrow('step timed out')
  })
})

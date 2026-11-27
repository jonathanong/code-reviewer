import { createHash } from 'node:crypto'

import { isPackageName, parseVersion } from './version.mts'

/** The one outbound host of the upgrade step. */
export const REGISTRY_ORIGIN = 'https://registry.npmjs.org'
export const MAX_TARBALL_BYTES = 5 * 1024 * 1024
export const REQUEST_TIMEOUT_MS = 15_000

/** Fetches a published tarball; `fetch` in production, a fake registry in tests. */
export type Fetcher = (
  url: string,
  init: { signal: AbortSignal; redirect: 'manual' },
) => Promise<Response>

/** The tarball URL of a version, built here from a validated name and version, never taken from a lockfile or registry document. */
export function tarballUrl(name: string, version: string): string {
  if (!isPackageName(name) || parseVersion(version) === undefined) {
    throw new Error(`${name}@${version} is not a registry package version`)
  }
  const base = name.slice(name.lastIndexOf('/') + 1)
  return `${REGISTRY_ORIGIN}/${name}/-/${base}-${version}.tgz`
}

async function readBounded(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > MAX_TARBALL_BYTES)
    throw new Error(`the tarball is over ${MAX_TARBALL_BYTES} bytes`)
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of response.body ?? []) {
    total += chunk.length
    if (total > MAX_TARBALL_BYTES) throw new Error(`the tarball is over ${MAX_TARBALL_BYTES} bytes`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * One published tarball, bounded in size and time, and equal to the lockfile's integrity when it
 * has one. Rejects on any failure: the caller turns that into a note and goes on.
 */
export async function fetchTarball(
  fetcher: Fetcher,
  name: string,
  version: string,
  integrity: string | undefined,
  signal: AbortSignal,
): Promise<Buffer> {
  const response = await fetcher(tarballUrl(name, version), {
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    redirect: 'manual',
  })
  if (!response.ok) throw new Error(`the registry answered ${response.status}`)
  const bytes = await readBounded(response)
  if (
    integrity !== undefined &&
    `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity
  ) {
    throw new Error('the tarball does not match the lockfile integrity')
  }
  return bytes
}

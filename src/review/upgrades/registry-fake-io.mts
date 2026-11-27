import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

import type { Fetcher } from './registry.mts'

type Entry = { name: string; body?: string | Buffer; type?: string; prefix?: string }

function field(text: string, length: number): Buffer {
  const buffer = Buffer.alloc(length)
  buffer.write(text)
  return buffer
}

/** One tar entry: a 512-byte ustar header and the padded body. */
function entry({ name, body = '', type = '0', prefix }: Entry): Buffer {
  const content = Buffer.from(body)
  const header = Buffer.alloc(512)
  header.write(name.slice(0, 100), 0)
  field(`${content.length.toString(8).padStart(11, '0')}\0`, 12).copy(header, 124)
  header.write(type, 156)
  if (prefix !== undefined) header.write(prefix, 345)
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512)
  content.copy(padded)
  return Buffer.concat([header, padded])
}

/** A gzipped tar of `files` (path to text) under `package/`, plus any raw `extra` entries. */
export function tarball(files: Record<string, string | Buffer>, extra: Entry[] = []): Buffer {
  const entries = Object.entries(files).map(([name, body]) =>
    entry({ name: `package/${name}`, body }),
  )
  const end = Buffer.alloc(1024)
  return gzipSync(Buffer.concat([...entries, ...extra.map(entry), end]))
}

export const integrityOf = (bytes: Buffer) =>
  `sha512-${createHash('sha512').update(bytes).digest('base64')}`

/** A registry that answers `url` from `bodies`; any other URL is a 404. Records the URLs asked. */
export function fakeRegistry(bodies: Record<string, Buffer | number>) {
  const asked: string[] = []
  const fetcher: Fetcher = async (url) => {
    asked.push(url)
    const body = bodies[url]
    if (body === undefined) return new Response('missing', { status: 404 })
    return typeof body === 'number'
      ? new Response('no', { status: body })
      : new Response(new Uint8Array(body))
  }
  return { fetcher, asked }
}

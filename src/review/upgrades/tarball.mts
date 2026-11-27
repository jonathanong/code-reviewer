import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'

const gunzipAsync = promisify(gunzip)

/** What a published package may unpack to; a larger one is refused whole. */
export const MAX_UNPACKED_BYTES = 25 * 1024 * 1024
const MAX_ENTRIES = 20_000
const BLOCK = 512

/** Package files by path relative to the package root. */
export type PackageFiles = Map<string, Buffer>

function text(block: Buffer, start: number, length: number): string {
  const field = block.subarray(start, start + length)
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? length : end).toString('utf8')
}

/** The path without its first component (npm uses `package/`), or undefined when it could leave the root. */
function relativePath(raw: string): string | undefined {
  const parts = raw.split('/').filter((part) => part !== '' && part !== '.')
  parts.shift()
  const unsafe = parts.length === 0 || parts.some((part) => part === '..' || part.includes('\\'))
  return unsafe || raw.startsWith('/') || raw.includes('\0') ? undefined : parts.join('/')
}

/** The `path` record of a pax extended header. */
function paxPath(body: Buffer): string | undefined {
  for (const record of body.toString('utf8').split('\n')) {
    const match = /^\d+ path=(.*)$/u.exec(record)
    if (match !== null) return match[1]
  }
  return undefined
}

/**
 * Unpacks a gzipped tar in memory. Only regular files are kept, so a link or device in the archive
 * does nothing, and every path is made relative to the package root, so none can leave it. Rejects
 * when the archive is not gzip or tar, or inflates past `MAX_UNPACKED_BYTES`.
 */
export async function unpackTarball(bytes: Buffer): Promise<PackageFiles> {
  const tar = await gunzipAsync(bytes, { maxOutputLength: MAX_UNPACKED_BYTES })
  const files: PackageFiles = new Map()
  let longName: string | undefined
  let offset = 0
  while (offset + BLOCK <= tar.length && files.size < MAX_ENTRIES) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (header.every((byte) => byte === 0)) break
    const size = Number.parseInt(text(header, 124, 12).trim(), 8)
    if (!Number.isInteger(size) || size < 0 || offset + BLOCK + size > tar.length) {
      throw new Error('the archive is not a valid tar')
    }
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + size)
    const type = String.fromCharCode(header[156] as number)
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK
    if (type === 'x' || type === 'L') {
      longName = type === 'x' ? paxPath(body) : text(body, 0, body.length)
      continue
    }
    const prefix = text(header, 345, 155)
    const raw =
      longName ?? (prefix === '' ? text(header, 0, 100) : `${prefix}/${text(header, 0, 100)}`)
    longName = undefined
    if (type !== '0' && type !== '\0') continue
    const path = relativePath(raw)
    if (path !== undefined) files.set(path, Buffer.from(body))
  }
  return files
}

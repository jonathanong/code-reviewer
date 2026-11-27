import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { tarball } from './registry-fake-io.mts'
import { unpackTarball } from './tarball.mts'

const header = (name: string, size: string) => {
  const block = Buffer.alloc(512)
  block.write(name, 0)
  block.write(`${size}\0`, 124)
  return block
}

const text = async (bytes: Buffer) =>
  Object.fromEntries(
    [...(await unpackTarball(bytes))].map(([path, body]) => [path, body.toString()]),
  )

describe('unpackTarball', () => {
  it('keeps regular files by path relative to the package root', async () => {
    const bytes = tarball({ 'package.json': '{}', 'dist/index.js': 'x'.repeat(600) })
    expect(await text(bytes)).toEqual({ 'package.json': '{}', 'dist/index.js': 'x'.repeat(600) })
  })

  it('keeps only regular files and paths that stay inside the package', async () => {
    const bytes = tarball({ 'ok.js': '1' }, [
      { name: 'package/link', type: '2' },
      { name: 'package/dir/', type: '5' },
      { name: 'package/../escape.js', body: 'x' },
      { name: '/abs.js', body: 'x' },
      { name: 'package/back\\slash.js', body: 'x' },
      { name: 'package/', body: 'x' },
    ])
    expect(await text(bytes)).toEqual({ 'ok.js': '1' })
  })

  it('reads a long path from a pax header and a GNU long name', async () => {
    const long = `package/${'d/'.repeat(80)}file.js`
    const bytes = tarball({}, [
      { name: 'pax', type: 'x', body: `${String(long.length + 12)} path=${long}\n` },
      { name: 'ignored', body: 'pax' },
      { name: 'gnu', type: 'L', body: 'package/gnu.js\0' },
      { name: 'ignored', body: 'gnu' },
      { name: 'pax-without-path', type: 'x', body: '30 mtime=1\n' },
      { name: 'package/fallback.js', body: 'fb' },
    ])
    expect(await text(bytes)).toEqual({
      [`${'d/'.repeat(80)}file.js`]: 'pax',
      'gnu.js': 'gnu',
      'fallback.js': 'fb',
    })
  })

  it('joins a ustar prefix to the name', async () => {
    const bytes = tarball({}, [{ name: 'deep/a.js', prefix: 'package', body: '1' }])
    expect(await text(bytes)).toEqual({ 'deep/a.js': '1' })
  })

  it('reads a name that fills its whole field', async () => {
    const name = `${'d'.repeat(91)}.js`
    const bytes = tarball({ [name.slice(0, 92)]: '1' })
    expect([...(await unpackTarball(bytes)).keys()]).toEqual([name.slice(0, 92)])
  })

  it('stops at the end of the archive blocks', async () => {
    expect(await unpackTarball(gzipSync(Buffer.alloc(1024)))).toEqual(new Map())
    expect(await unpackTarball(gzipSync(Buffer.alloc(0)))).toEqual(new Map())
  })

  it.each([
    [
      'a header with no size',
      gzipSync(Buffer.concat([Buffer.from('package/a'), Buffer.alloc(503)])),
    ],
    ['a size that runs past the end', gzipSync(header('package/a', '00000100000'))],
  ])('rejects %s', async (_name, bytes) => {
    await expect(unpackTarball(bytes)).rejects.toThrow('not a valid tar')
  })

  it('rejects bytes that are not gzip at all', async () => {
    await expect(unpackTarball(Buffer.from('plain text'))).rejects.toThrow()
  })

  it('refuses an archive that inflates past the limit', async () => {
    const bomb = gzipSync(Buffer.alloc(26 * 1024 * 1024))
    await expect(unpackTarball(bomb)).rejects.toThrow()
  })
})

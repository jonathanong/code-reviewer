import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearPush, readPushFile, writePush } from './push-file.mts'
import type { PushInspection } from './push-types.mts'

let out: string
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'push-file-'))
})
afterEach(() => rmSync(out, { recursive: true, force: true }))

const read = (name: string) => readFileSync(join(out, name), 'utf8')

const RESOLUTION =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n one\n-<<<<<<< ours\n+both\n'
const inspection = (rest: Partial<PushInspection>): PushInspection => ({
  kind: 'base-merges-only',
  reason: 'r',
  reviewedSha: 'r'.repeat(40),
  headSha: 'h'.repeat(40),
  merges: [],
  mergesTotal: 0,
  problems: [],
  ...rest,
})

describe('writePush', () => {
  it('writes one numbered patch per resolved merge, an index, and what the paths are', () => {
    const merges = [
      { sha: 'a'.repeat(40), resolution: '', truncated: false },
      { sha: 'b'.repeat(40), resolution: RESOLUTION, truncated: true },
    ]
    const file = writePush(out, inspection({ merges, mergesTotal: 2 }), writeFileSync)
    const patch = join('merges', `${'b'.repeat(12)}.patch`)
    expect(file.merges).toEqual([
      { sha: 'a'.repeat(40), resolution: 'clean' },
      { sha: 'b'.repeat(40), resolution: 'resolved', file: patch, truncated: true },
    ])
    expect(file).toMatchObject({ resolvedPaths: ['src/a.ts'], mergesCapped: false })
    expect(read(patch)).toMatch(/\s+1\s+1\s+ one/u)
    const index = read(join('merges', 'INDEX.md'))
    expect(index).toContain(`\`${'a'.repeat(12)}\`: clean merge`)
    expect(index).toContain('(cut: too large)')
    expect(JSON.parse(read('push.json'))).toEqual(file)
  })

  it('says how many merges are listed when there are more', () => {
    const merges = [{ sha: 'a'.repeat(40), resolution: '', truncated: false }]
    const file = writePush(out, inspection({ merges, mergesTotal: 25 }), writeFileSync)
    expect(file.mergesCapped).toBe(true)
    expect(read(join('merges', 'INDEX.md'))).toContain('Only 1 of 25 merges are listed.')
  })

  it('writes the range-diff and the incoming base changes when there are some', () => {
    const incoming = { from: 'f', to: 't', diff: RESOLUTION }
    const file = writePush(
      out,
      inspection({ rangeDiff: '1: a < -: b x\n', incoming }),
      writeFileSync,
    )
    expect(file).toMatchObject({
      rangeDiff: 'range-diff.txt',
      incoming: join('incoming', 'INDEX.md'),
    })
    expect(read('range-diff.txt')).toBe('1: a < -: b x\n')
    expect(read(join('incoming', 'INDEX.md'))).toContain('src/a.ts')
    expect(existsSync(join(out, 'merges'))).toBe(false)
  })

  it('records only the kind and the problems for a push git could not read', () => {
    const file = writePush(
      out,
      inspection({ kind: 'substantive', problems: ['no git'] }),
      writeFileSync,
    )
    expect(file).toMatchObject({ kind: 'substantive', merges: [], problems: ['no git'] })
    expect(file.rangeDiff).toBeUndefined()
    expect(file.incoming).toBeUndefined()
  })
})

describe('readPushFile and clearPush', () => {
  it('reads what was written, and is undefined without a push', () => {
    expect(readPushFile(out)).toBeUndefined()
    const file = writePush(out, inspection({}), writeFileSync)
    expect(readPushFile(out)).toEqual(file)
  })

  it('removes the push, its merges, its incoming changes and its range-diff', () => {
    mkdirSync(join(out, 'merges'))
    mkdirSync(join(out, 'incoming'))
    for (const name of ['push.json', 'range-diff.txt']) writeFileSync(join(out, name), '')
    clearPush(out)
    for (const name of ['push.json', 'merges', 'incoming', 'range-diff.txt']) {
      expect(existsSync(join(out, name))).toBe(false)
    }
  })
})

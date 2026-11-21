import { describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import { heldEvidence } from './evidence-reuse.mts'
import { EVIDENCE_LIMITS } from './evidence-schema.mts'

const OLD = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)

const item = (over: Record<string, unknown> = {}) => ({
  name: 'docs',
  status: 'checked',
  queries: [{ command: 'grep x docs/a.md', result: '3', control: { command: 'c', result: '9' } }],
  headSha: OLD,
  scope: { kind: 'paths', paths: ['docs/'] },
  ...over,
})

function reuse(saved: unknown, changed: string | Error = '') {
  const exec = vi.fn<Exec>(async () => {
    if (changed instanceof Error) throw changed
    return changed
  })
  const readFile = vi.fn(async (path: string) => {
    if (saved instanceof Error) throw saved
    expect(path).toBe('/run/evidence.json')
    return typeof saved === 'string' ? saved : JSON.stringify(saved)
  })
  return {
    exec,
    held: heldEvidence({ runDir: '/run', headSha: HEAD, tree: '/tree', exec, readFile }),
  }
}

describe('heldEvidence', () => {
  it('holds a checked source whose declared paths did not change, with its query results', async () => {
    const { held, exec } = reuse({ sources: [item()] }, 'src/a.ts\0README.md\0')
    expect(await held).toEqual([
      { source: 'docs', commit: OLD, status: 'checked', result: 'grep x docs/a.md -> 3' },
    ])
    expect(exec).toHaveBeenCalledWith('git', [
      '-C',
      '/tree',
      'diff',
      '--name-only',
      '-z',
      `${OLD}..${HEAD}`,
    ])
  })

  it('compares each head once and drops a source whose declared path changed', async () => {
    const { held, exec } = reuse(
      { sources: [item(), item({ name: 'cfg', scope: { kind: 'paths', paths: ['a.yml'] } })] },
      'a.yml\0',
    )
    expect((await held).map((entry) => entry.source)).toEqual(['docs'])
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('caps the result text at the evidence result limit', async () => {
    const long = 'x'.repeat(EVIDENCE_LIMITS.result * 2)
    const { held } = reuse({ sources: [item({ queries: [{ command: 'c d', result: long }] })] })
    const [only] = await held
    expect(only?.result).toHaveLength(EVIDENCE_LIMITS.result)
    expect(only?.result.endsWith('…')).toBe(true)
  })

  it.each([
    ['unknown scope', { scope: { kind: 'unknown' } }],
    ['no scope', { scope: undefined }],
    ['no sha', { headSha: undefined }],
    ['a sha that is not hex', { headSha: '--output=x' }],
    ['a blocked status', { status: 'blocked' }],
    ['an empty path list', { scope: { kind: 'paths', paths: [] } }],
    ['no name', { name: 3 }],
  ])('does not hold a source with %s', async (_label, over) => {
    expect(await reuse({ sources: [item(over)] }).held).toEqual([])
  })

  it('holds nothing when git cannot say what changed', async () => {
    expect(await reuse({ sources: [item()] }, new Error('bad object')).held).toEqual([])
  })

  it('holds nothing for an unreadable, malformed or sourceless file', async () => {
    expect(await reuse(new Error('ENOENT')).held).toEqual([])
    expect(await reuse('not json').held).toEqual([])
    expect(await reuse([]).held).toEqual([])
    expect(await reuse({}).held).toEqual([])
  })

  it('reads an item without queries as an empty result', async () => {
    const { held } = reuse({ sources: [item({ queries: undefined })] })
    expect(await held).toEqual([{ source: 'docs', commit: OLD, status: 'checked', result: '' }])
  })
})

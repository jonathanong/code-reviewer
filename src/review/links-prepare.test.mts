import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LinkedLookup } from './links-query.mts'
import { prepareDependencies, prepareLinks } from './links-prepare.mts'
import type { PrepareIo } from './prepare-io.mts'
import type { StackFile } from './stack-file.mts'

const ARGS = { repo: 'acme/widgets', pr: 9, baseSha: 'b', headSha: 'h' }

function fakeIo(found: LinkedLookup['found'] = new Map(), problems: string[] = []) {
  const io = {
    self: { repo: 'acme/widgets', number: 9 },
    linked: vi.fn(async () => ({ found, problems })),
    commitMessages: vi.fn(async () => ['fix\n\nAfter #20 lands.\n']),
  }
  return { io, asIo: io as unknown as PrepareIo }
}

describe('prepareDependencies', () => {
  it('asks nothing when no reference is a precondition', async () => {
    const { io, asIo } = fakeIo()
    expect(
      await prepareDependencies(asIo, { ...ARGS, body: 'Fixes #1. See #2.', commits: [] }),
    ).toEqual({
      dependencies: [],
      problems: [],
    })
    expect(io.linked).not.toHaveBeenCalled()
  })

  it('names each reference with its state, kind and where it was named, from one lookup', async () => {
    const found = new Map([
      ['acme/widgets#12', { kind: 'pull' as const, state: 'open' as const, restricted: false }],
      ['acme/lib#3', { kind: 'issue' as const, state: 'closed' as const, restricted: false }],
    ])
    const { io, asIo } = fakeIo(found)
    const result = await prepareDependencies(asIo, {
      ...ARGS,
      body: 'Depends on #12 and acme/lib#3.',
      commits: ['feat\n\nRequires #12 and #20.'],
    })
    expect(io.linked).toHaveBeenCalledTimes(1)
    expect(result.dependencies).toEqual([
      { on: '#12', kind: 'pull', state: 'open', why: 'Named in the description.' },
      { on: 'acme/lib#3', kind: 'issue', state: 'closed', why: 'Named in the description.' },
      { on: '#20', kind: 'other', state: 'unknown', why: 'Named in a commit message.' },
    ])
  })

  it('keeps a reference whose state cannot be read, as unknown, with the lookup problem', async () => {
    const { asIo } = fakeIo(new Map(), ['Could not read acme/widgets#12: not found.'])
    const result = await prepareDependencies(asIo, { ...ARGS, body: 'Blocked by #12', commits: [] })
    expect(result.dependencies[0]?.state).toBe('unknown')
    expect(result.problems).toEqual(['Could not read acme/widgets#12: not found.'])
  })

  it('does not read a private repository named from a public one', async () => {
    const found = new Map([
      ['secret/repo#1', { kind: 'pull' as const, state: 'merged' as const, restricted: true }],
    ])
    const { asIo } = fakeIo(found)
    const result = await prepareDependencies(asIo, {
      ...ARGS,
      body: 'Depends on secret/repo#1',
      commits: [],
    })
    expect(result.dependencies[0]).toMatchObject({ on: 'secret/repo#1', state: 'unknown' })
    expect(result.problems).toEqual([
      'secret/repo#1 is in a private repository, so its state was not read.',
    ])
  })

  it('looks up at most ten references', async () => {
    const { io, asIo } = fakeIo()
    const body = Array.from({ length: 14 }, (_, at) => `depends on #${at + 20}`).join('\n')
    await prepareDependencies(asIo, { ...ARGS, body, commits: [] })
    expect(io.linked.mock.calls[0]).toHaveLength(1)
    const refs = (io.linked.mock.calls[0] as unknown as [unknown[]])[0]
    expect(refs).toHaveLength(10)
  })
})

describe('prepareLinks', () => {
  let out: string
  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'links-'))
  })
  afterEach(() => rmSync(out, { recursive: true, force: true }))
  const args = { ...ARGS, body: '', headlines: ['headline only'] }

  it('writes nothing when there is nothing to depend on', async () => {
    const { asIo } = fakeIo()
    const written: string[] = []
    const result = await prepareLinks(asIo, out, (path) => void written.push(path), args)
    expect(result).toEqual({ written: [], problems: [] })
    expect(written).toEqual([])
  })

  it('reads full commit messages in a checkout, and writes the stack parents with what was named', async () => {
    const { io, asIo } = fakeIo()
    const stack = { members: [{ number: 3 }, { number: 9 }], index: 1 } as unknown as StackFile
    const result = await prepareLinks(
      asIo,
      out,
      (path, text) => {
        expect(path).toBe(join(out, 'dependencies.json'))
        expect(JSON.parse(text).map((entry: { on: string }) => entry.on)).toEqual(['#3', '#20'])
      },
      { ...args, tree: '/t', stack },
    )
    expect(io.commitMessages).toHaveBeenCalledWith('/t', 'b', 'h')
    expect(result.written).toEqual(['dependencies.json'])
  })

  it('falls back to the commit headlines, and says so, when git cannot give the messages', async () => {
    const { io, asIo } = fakeIo()
    io.commitMessages.mockRejectedValue(new Error('bad revision\nmore'))
    const result = await prepareLinks(asIo, out, () => undefined, {
      ...args,
      tree: '/t',
      headlines: ['Depends on #31'],
    })
    expect(result.written).toEqual(['dependencies.json'])
    expect(result.problems).toEqual([
      'Commit messages could not be read, so only their headlines were: bad revision',
    ])
    io.commitMessages.mockRejectedValue('plain')
    expect(
      (await prepareLinks(asIo, out, () => undefined, { ...args, tree: '/t' })).problems[0],
    ).toContain('plain')
  })

  it('uses the headlines without a checkout', async () => {
    const { io, asIo } = fakeIo()
    const result = await prepareLinks(
      asIo,
      out,
      (_path, text) => {
        expect(JSON.parse(text)[0].on).toBe('#31')
      },
      { ...args, headlines: ['Depends on #31'] },
    )
    expect(io.commitMessages).not.toHaveBeenCalled()
    expect(result.written).toEqual(['dependencies.json'])
    expect(() => readFileSync(join(out, 'dependencies.json'))).toThrow()
  })
})

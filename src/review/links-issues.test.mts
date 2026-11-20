import { describe, expect, it, vi } from 'vitest'

import type { Linked } from './links-query.mts'
import { prepareIssues } from './links-issues.mts'
import type { PrepareIo } from './prepare-io.mts'

const pull = (body: string) =>
  ({ body, closingIssuesReferences: { nodes: [{ number: 4 }] } }) as never
const issue = (extra: Partial<Linked> = {}): Linked => ({
  kind: 'issue',
  state: 'open',
  restricted: false,
  title: 'Title',
  body: 'Body',
  ...extra,
})

function setup(found: Map<string, Linked> = new Map(), problems: string[] = []) {
  const linked = vi.fn(async (_refs: unknown) => ({ found, problems }))
  const write = vi.fn()
  const io = { linked, self: { repo: 'acme/widgets', number: 9 } } as unknown as PrepareIo
  return { linked, write, run: (body: string) => prepareIssues(io, '/out', write, pull(body)) }
}

describe('prepareIssues', () => {
  it('asks and writes nothing when the description refers to no other issue', async () => {
    const { linked, write, run } = setup()
    expect(await run('Fixes #4. Nothing else.')).toEqual({ issues: [], written: [], problems: [] })
    expect(linked).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('reads each referenced issue, in this repository or another, but not the closing ones', async () => {
    const found = new Map([
      ['acme/widgets#5', issue()],
      ['acme/lib#2', issue({ state: 'closed', title: 'Other', body: 'Other body' })],
    ])
    const { linked, write, run } = setup(found)
    const result = await run(
      'Fixes #4. See #5 and acme/lib#2, https://github.com/acme/lib/issues/2.',
    )
    expect(linked).toHaveBeenCalledTimes(1)
    expect(linked.mock.calls[0]?.[0]).toEqual([
      { repo: 'acme/widgets', number: 5 },
      { repo: 'acme/lib', number: 2 },
    ])
    expect(result.issues).toEqual([
      { ref: 'acme/widgets#5', state: 'open', title: 'Title', body: 'Body' },
      { ref: 'acme/lib#2', state: 'closed', title: 'Other', body: 'Other body' },
    ])
    expect(result.written).toEqual(['issues.json'])
    expect(write).toHaveBeenCalledWith('/out/issues.json', expect.stringContaining('acme/lib#2'))
  })

  it('bounds the number of issues and the size of each', async () => {
    const found = new Map([
      ['acme/widgets#10', issue({ title: 't'.repeat(500), body: 'b'.repeat(5000) })],
    ])
    const { linked, run } = setup(found)
    const result = await run(Array.from({ length: 12 }, (_, at) => `#${at + 10}`).join(' '))
    expect((linked.mock.calls[0]?.[0] as unknown[]).length).toBe(8)
    expect(result.issues[0]?.title).toHaveLength(200)
    expect(result.issues[0]?.body).toHaveLength(1500)
    expect(result.issues[0]?.body.endsWith('…')).toBe(true)
  })

  it('leaves out pull requests, unreadable references and private repositories, and says why', async () => {
    const found = new Map<string, Linked>([
      ['acme/widgets#5', { kind: 'pull', state: 'open', restricted: false }],
      ['secret/repo#1', issue({ restricted: true })],
      ['acme/widgets#7', { kind: 'issue', state: 'open', restricted: false }],
    ])
    const { run } = setup(found, ['Could not read acme/widgets#6.'])
    const result = await run('#5 #6 secret/repo#1 #7')
    expect(result.issues).toEqual([{ ref: 'acme/widgets#7', state: 'open', title: '', body: '' }])
    expect(result.problems).toEqual([
      'Could not read acme/widgets#6.',
      'secret/repo#1 is in a private repository, so its text was not read.',
    ])
  })

  it('writes nothing when no referenced issue could be read', async () => {
    const { write, run } = setup(new Map(), ['Could not read acme/widgets#6.'])
    expect(await run('#6')).toEqual({
      issues: [],
      written: [],
      problems: ['Could not read acme/widgets#6.'],
    })
    expect(write).not.toHaveBeenCalled()
  })
})

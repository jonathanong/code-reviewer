import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../cli/command-review.mts', () => ({ reviewCommand: vi.fn() }))

import { reviewCommand } from '../cli/command-review.mts'
import { conversation } from '../review/prepare-fake-io.mts'
import type { RunValues } from './command.mts'
import { PULL, runWith, setup as makeFake, type Fake } from './harness.mts'
import type { RunLine } from './output.mts'

let root: string
let stdout: string[]

async function run(fake: Fake, values: RunValues = PULL): Promise<{ code: number; line: RunLine }> {
  const { code, lines } = await runWith(fake, stdout, values)
  expect(lines).toHaveLength(1)
  return { code, line: lines[0] as RunLine }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'run-request-focus-'))
  mkdirSync(join(root, 'tmp'))
  stdout = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.mocked(reviewCommand).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

const enabled = { requestFocus: { enabled: true } }
const labels = ['final-review:requested']
const asked = (body: string, login = 'peer') => ({
  ...conversation(null, { login: 'dev', __typename: 'User' }),
  comments: { nodes: [{ author: { login }, body, createdAt: '2026-01-01T00:00:00Z' }] },
})
const sent = () => vi.mocked(reviewCommand).mock.calls[0]?.[0] as Record<string, unknown>

describe('runCommand with a check list in the request', () => {
  it('passes the list the requester commented as focus points', async () => {
    const fake = makeFake(root, {
      ownerConfig: enabled,
      labels,
      labeledBy: 'peer',
      conversation: asked('Please check:\n- no wrappers or re-exports'),
    })
    const { line } = await run(fake)
    expect(sent()).toMatchObject({ focusPoints: ['no wrappers or re-exports'] })
    expect(line.problems).toEqual([])
    expect(fake.labelIo.labeledBy).toHaveBeenCalledWith('final-review:requested')
  })

  it('is off until configured: no timeline or conversation read, no points', async () => {
    const fake = makeFake(root, { labels, labeledBy: 'peer' })
    await run(fake)
    expect(sent()).not.toHaveProperty('focusPoints')
    expect(fake.labelIo.labeledBy).not.toHaveBeenCalled()
  })

  it('lets --focus win and reads nothing', async () => {
    const focus = join(root, 'focus.txt')
    writeFileSync(focus, 'the file point\n')
    const fake = makeFake(root, { ownerConfig: enabled, labels, labeledBy: 'peer' })
    await run(fake, { ...PULL, focus })
    expect(sent()).toMatchObject({ focusPoints: ['the file point'] })
    expect(fake.labelIo.labeledBy).not.toHaveBeenCalled()
  })

  it('reads nothing for a run with no request label', async () => {
    const fake = makeFake(root, { ownerConfig: enabled, labeledBy: 'peer' })
    await run(fake)
    expect(sent()).not.toHaveProperty('focusPoints')
    expect(fake.labelIo.labeledBy).not.toHaveBeenCalled()
  })

  it.each([
    ['no one is recorded as adding the label', undefined, asked('Focus: x')],
    ['the reviewer itself added the label', 'reviewer[bot]', asked('Focus: x', 'reviewer[bot]')],
    ['the requester left no list', 'peer', asked('looks good')],
  ])('passes no points when %s', async (_name, labeledBy, conversation) => {
    const fake = makeFake(root, { ownerConfig: enabled, labels, labeledBy, conversation })
    const { line } = await run(fake)
    expect(sent()).not.toHaveProperty('focusPoints')
    expect(line.problems).toEqual([])
  })

  it('goes on without points and reports a list over the limits', async () => {
    const fake = makeFake(root, {
      ownerConfig: enabled,
      labels,
      labeledBy: 'peer',
      conversation: asked(`Focus:\n- ${'x'.repeat(501)}`),
    })
    const { code, line } = await run(fake)
    expect(code).toBe(0)
    expect(sent()).not.toHaveProperty('focusPoints')
    expect(line.problems).toEqual([
      expect.stringContaining("requested checks in the requester's comment: line 1 is 501"),
    ])
    expect(line.attention).toEqual(line.problems)
  })

  it('goes on without points and reports a read that failed', async () => {
    const fake = makeFake(root, { ownerConfig: enabled, labels, labeledBy: 'peer' })
    fake.labelIo.labeledBy.mockRejectedValue('timeline gone')
    const { line } = await run(fake)
    expect(sent()).not.toHaveProperty('focusPoints')
    expect(line.problems).toEqual(['requested checks were not used: timeline gone'])
  })
})

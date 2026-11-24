import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../cli/command-review.mts', () => ({ reviewCommand: vi.fn() }))

import { reviewCommand } from '../cli/command-review.mts'
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
  root = mkdtempSync(join(tmpdir(), 'run-focus-'))
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

describe('runCommand with --focus', () => {
  it('passes the points of the file to the review', async () => {
    const focus = join(root, 'focus.txt')
    writeFileSync(focus, '- the retry is bounded\n- logging stays quiet\n')
    await run(makeFake(root), { ...PULL, focus })
    expect(vi.mocked(reviewCommand).mock.calls[0]?.[0]).toMatchObject({
      focusPoints: ['the retry is bounded', 'logging stays quiet'],
    })
  })

  it('passes no points without the flag', async () => {
    await run(makeFake(root))
    expect(vi.mocked(reviewCommand).mock.calls[0]?.[0]).not.toHaveProperty('focusPoints')
  })

  it('stops before any work when the file is missing, naming the flag and the file', async () => {
    const fake = makeFake(root)
    const { code, line } = await run(fake, { ...PULL, focus: join(root, 'missing.txt') })
    expect(code).toBe(12)
    expect(line.outcome).toBe('error')
    expect(line.reason).toContain('--focus')
    expect(line.reason).toContain('missing.txt')
    expect(fake.io.headSha).not.toHaveBeenCalled()
    expect(vi.mocked(reviewCommand)).not.toHaveBeenCalled()
  })
})

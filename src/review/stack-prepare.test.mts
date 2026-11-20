import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrepareIo } from './prepare-io.mts'
import { readStackFile } from './stack-file.mts'
import { prepareStack } from './stack-prepare.mts'
import type { StackMember } from './stack.mts'

const pull = (number: number, headRef: string, baseRef: string): StackMember => ({
  number,
  title: `T${number}`,
  headRef,
  baseRef,
  headSha: `sha${number}`,
})
const PATCH = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n'
const STACK = [pull(1, 'a', 'main'), pull(2, 'b', 'a'), pull(3, 'c', 'b'), pull(4, 'd', 'c')]

function io(
  pr: number,
  pulls: StackMember[],
  memberDiff = async (_member: StackMember, _base: string, _tree?: string) => PATCH,
) {
  return {
    stackInput: vi.fn(async () => ({ pr, pulls, defaultBranch: 'main' })),
    memberDiff: vi.fn(memberDiff),
  } as unknown as PrepareIo & { memberDiff: ReturnType<typeof vi.fn> }
}

let out: string
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'stack-'))
})
afterEach(() => rmSync(out, { recursive: true, force: true }))

describe('prepareStack', () => {
  it('writes nothing for a flat pull request', async () => {
    expect(await prepareStack(io(1, [pull(1, 'a', 'main')]), out, writeFileSync)).toEqual({})
    expect(existsSync(join(out, 'stack.json'))).toBe(false)
    expect(existsSync(join(out, 'stack'))).toBe(false)
  })

  it('writes stack.json and an index with one numbered patch per file for the later members', async () => {
    const reads = io(2, STACK)
    const { stack, problem } = await prepareStack(reads, out, writeFileSync)
    expect(problem).toBeUndefined()
    expect(
      reads.memberDiff.mock.calls.map(([member, base, tree]) => [member.number, base, tree]),
    ).toEqual([
      [3, 'sha2', undefined],
      [4, 'sha3', undefined],
    ])
    expect(stack?.members.map((member) => member.diff)).toEqual([
      undefined,
      undefined,
      join('stack', '3', 'INDEX.md'),
      join('stack', '4', 'INDEX.md'),
    ])
    expect(readStackFile(out)).toEqual(stack)
    expect(readFileSync(join(out, 'stack', '3', 'INDEX.md'), 'utf8')).toContain('a.ts')
    expect(readFileSync(join(out, 'stack', '3', '0001.patch'), 'utf8')).toContain(
      '     1        -x',
    )
    expect(existsSync(join(out, 'stack', '3.patch'))).toBe(false)
  })

  it('writes a large diff and skips only one over the 20 MB member limit', async () => {
    const large = `${PATCH}${'+x\n'.repeat(1_000_000)}`
    const huge = `${PATCH}${'+x\n'.repeat(7_000_000)}`
    const { stack } = await prepareStack(
      io(2, STACK, async (member) => (member.number === 3 ? huge : large)),
      out,
      writeFileSync,
    )
    expect(stack?.members[2]?.diff).toBeUndefined()
    expect(stack?.members[2]?.diffSkipped).toContain('bytes')
    expect(existsSync(join(out, 'stack', '3'))).toBe(false)
    expect(stack?.members[3]?.diff).toBe(join('stack', '4', 'INDEX.md'))
  })

  it('records a diff that could not be read without failing', async () => {
    const { stack, problem } = await prepareStack(
      io(2, STACK, async (member) => {
        if (member.number === 3) throw new Error('boom\nmore')
        return PATCH
      }),
      out,
      writeFileSync,
    )
    expect(problem).toBeUndefined()
    expect(stack?.members[2]?.diffSkipped).toBe('the diff could not be read: boom')
    expect(stack?.members[3]?.diff).toBeDefined()
  })

  it('returns a problem and no stack when the open pull requests cannot be listed', async () => {
    const failing = io(2, STACK)
    failing.stackInput = vi.fn(async () => {
      throw new Error('rate limited')
    })
    const result = await prepareStack(failing, out, writeFileSync)
    expect(result.stack).toBeUndefined()
    expect(result.problem).toContain('rate limited')
    expect(readStackFile(out)).toBeUndefined()
  })

  it('passes the tree through to the diff reader', async () => {
    const reads = io(2, STACK)
    await prepareStack(reads, out, writeFileSync, '/tree')
    expect(reads.memberDiff.mock.calls[0]?.[2]).toBe('/tree')
  })

  it('names a non-Error rejection', async () => {
    const failing = io(2, STACK)
    failing.stackInput = vi.fn(() => Promise.reject('plain'))
    expect((await prepareStack(failing, out, writeFileSync)).problem).toContain('plain')
  })
})

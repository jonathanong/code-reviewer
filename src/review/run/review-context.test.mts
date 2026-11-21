import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import { SECTIONS } from '../context/build.mts'
import {
  CONTEXT_DEADLINE_MS,
  CONTEXT_FILE,
  PILLAR_SECTIONS,
  buildReviewContext,
  type ReviewContextInput,
} from './review-context.mts'

const dirs: string[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const plugin = fileURLToPath(new URL('../context/fixtures/plugin', import.meta.url))

type Overrides = { selected?: string[]; out?: string }

function input(exec: Exec, overrides: Overrides = {}): ReviewContextInput {
  const out = overrides.out ?? mkdtempSync(join(tmpdir(), 'review-context-'))
  dirs.push(out)
  return {
    steps: { exec, rulePlugins: ['team'] },
    options: { repo: 'o/r', pr: 1, tree: '/tree', out },
    prepared: { baseSha: 'b', headSha: 'h' },
    installs: [{ name: 'team', installPath: plugin }],
    skillChoice: { selected: overrides.selected ?? ['team:sample-rules'] },
  }
}

describe('PILLAR_SECTIONS', () => {
  it('names real sections and leaves change-shape out', () => {
    const known = SECTIONS.map((section) => section.name)
    expect(PILLAR_SECTIONS.every((name) => known.includes(name))).toBe(true)
    expect(PILLAR_SECTIONS).not.toContain('change-shape')
  })
})

describe('buildReviewContext', () => {
  it('writes the selected skills excerpts to review-context.md', async () => {
    const built = await buildReviewContext(input(async () => ''))
    expect(built).toEqual({ file: expect.stringContaining(CONTEXT_FILE) })
    const text = readFileSync((built as { file: string }).file, 'utf8')
    expect(text).toContain('### team:sample-rules')
    expect(text).not.toContain('team:sample-prose')
  })

  it('gives every command a timeout and the deadline signal, and runs no change-shape call', async () => {
    const calls: { args: string[]; options: Parameters<Exec>[2] }[] = []
    const exec: Exec = async (_command, args, options) => {
      calls.push({ args, options })
      return ''
    }
    await buildReviewContext(input(exec))
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.options?.timeoutMs).toBeGreaterThan(0)
      expect(call.options?.signal).toBeInstanceOf(AbortSignal)
    }
    expect(calls.some((call) => call.args.includes('--numstat'))).toBe(false)
  })

  it('hands back the linked commits it found, and none when there are none', async () => {
    const sha = 'a'.repeat(40)
    const exec: Exec = async (_command, args) => {
      const git = args.slice(2)
      if (git[0] === 'log' && git.at(-1) === 'b..h') return `Fixes ${sha}\u001e`
      if (git[0] === 'show') return `${sha}\u001faaaaaaa\u001f2024-01-01\u001fAdd cache\nsrc/c.ts\n`
      return ''
    }
    const built = await buildReviewContext(input(exec))
    expect(built.linked).toEqual([{ sha, subject: 'Add cache', how: 'fixes', files: ['src/c.ts'] }])
    expect(await buildReviewContext(input(async () => ''))).not.toHaveProperty('linked')
  })

  it('gives a note and no file when nothing has anything to say', async () => {
    const built = await buildReviewContext(input(async () => '', { selected: [] }))
    expect(built).toEqual({ note: 'no section had anything to say' })
  })

  it('gives a note when the file cannot be written', async () => {
    const built = await buildReviewContext(input(async () => '', { out: '/nonexistent/context' }))
    expect(built).toEqual({ note: expect.stringContaining('ENOENT') })
  })

  it('gives up at the deadline and aborts the commands', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const exec: Exec = (_command, _args, options) => {
      signal = options?.signal
      return new Promise(() => {})
    }
    const pending = buildReviewContext(input(exec), CONTEXT_DEADLINE_MS)
    await vi.advanceTimersByTimeAsync(CONTEXT_DEADLINE_MS)
    expect(await pending).toEqual({ note: 'timed out after 60s' })
    expect(signal?.aborted).toBe(true)
  })

  it('names a failed section in the note when no section had content', async () => {
    const exec: Exec = async () => {
      throw new Error('command broke\nmore')
    }
    const built = await buildReviewContext(input(exec, { selected: [] }))
    expect(built).toEqual({
      note: expect.stringContaining('no section had anything to say'),
    })
  })
})

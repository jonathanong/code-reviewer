import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import { CONTEXT_DEADLINE_MS } from './types.mts'
import { SECTIONS } from '../context/build.mts'
import { mixedRepo } from '../context/change-shape/split-fixtures.mts'
import {
  CONTEXT_FILE,
  PILLAR_SECTIONS,
  buildReviewContext,
  reportFields,
  verifierContextFields,
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

  it('gives every command a timeout and the deadline signal', async () => {
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

  it('hands back the split summary of a large mixed change, and keeps change-shape out of the file', async () => {
    const built = await buildReviewContext(input(mixedRepo()))
    expect(built.split?.mechanical.files).toBe(40)
    expect(readFileSync(built.file as string, 'utf8')).not.toContain('Change shape')
    expect(await buildReviewContext(input(async () => ''))).not.toHaveProperty('split')
  })

  it('hands back the split summary even when no section is for the pillars', async () => {
    const git = mixedRepo()
    const diffOnly: Exec = async (command, args, options) =>
      args[0] === 'diff' ? git(command, args, options) : ''
    const built = await buildReviewContext(input(diffOnly, { selected: [] }))
    expect(built).not.toHaveProperty('file')
    expect(built.note).toContain('no section had anything to say')
    expect(built.split?.lines).toBe(362)
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

  it('gives up at the configured deadline, named in the note', async () => {
    vi.useFakeTimers()
    const exec: Exec = () => new Promise(() => {})
    const pending = buildReviewContext(input(exec), 5000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toEqual({ note: 'timed out after 5s' })
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

describe('buildReviewContext on a follow-up', () => {
  const stateRun = fileURLToPath(new URL('../context/fixtures/state/run-1', import.meta.url))
  const OLD = '1'.repeat(40)
  const row = (runDir: string | null) =>
    `${JSON.stringify({ repo: 'o/r', pr: 1, head: OLD, state: 'posted', mode: 'full', verdict: 'Comment', startedAt: '2026-01-01T00:00:00Z', runDir })}\n`

  function state(tracker: string | null) {
    const dir = mkdtempSync(join(tmpdir(), 'review-state-'))
    dirs.push(dir)
    if (tracker !== null) writeFileSync(join(dir, 'reviews.jsonl'), tracker)
    return dir
  }

  function followUp(exec: Exec, stateDir: string | undefined, sinceSha: string | null = OLD) {
    const base = input(exec)
    return {
      ...base,
      steps: { ...base.steps, ...(stateDir === undefined ? {} : { stateDir }) },
      prepared: { baseSha: 'b', headSha: 'h', plan: { sinceSha } },
    }
  }

  it('hands the verifier the earlier review at an ancestor, and keeps it out of the pillars file', async () => {
    const built = await buildReviewContext(followUp(async () => '', state(row(stateRun))))
    expect(built.previous).toMatchObject({ sha: OLD, posted: true, verdict: 'Comment' })
    expect(built.previous?.findings.map((finding) => finding.title)).toEqual([
      'Token logged in clear',
      'Stale comment',
    ])
    expect(built).not.toHaveProperty('previousNote')
    expect(readFileSync(built.file as string, 'utf8')).not.toContain('Past reviews')
    expect(verifierContextFields(built)).toEqual({ previous: built.previous })
  })

  it('reads nothing on a first review, however many earlier ones the tracker holds', async () => {
    const calls: string[][] = []
    const exec: Exec = async (_command, args) => {
      calls.push(args)
      return ''
    }
    const built = await buildReviewContext(followUp(exec, state(row(stateRun)), null))
    expect(built).not.toHaveProperty('previous')
    expect(calls.some((args) => args.includes('--is-ancestor'))).toBe(false)
    expect(verifierContextFields(built)).toEqual({})
  })

  it('reads nothing without a state directory', async () => {
    const built = await buildReviewContext(followUp(async () => '', undefined))
    expect(built).not.toHaveProperty('previous')
    expect(built).not.toHaveProperty('previousNote')
  })

  it('gives no earlier review and no note when its head is not an ancestor', async () => {
    const exec: Exec = async (_command, args) => {
      if (args.includes('--is-ancestor')) throw new Error('not an ancestor')
      return ''
    }
    const built = await buildReviewContext(followUp(exec, state(row(stateRun))))
    expect(built).not.toHaveProperty('previous')
    expect(built).not.toHaveProperty('previousNote')
  })

  it('notes a missing run directory and goes on with the pillars file', async () => {
    const built = await buildReviewContext(followUp(async () => '', state(row('/nowhere/run'))))
    expect(built.previous).toBeUndefined()
    expect(built.previousNote).toContain('is gone')
    expect(built.file).toContain(CONTEXT_FILE)
    expect(reportFields(built)).toMatchObject({ earlierReviewNote: built.previousNote })
  })

  it('notes a tracker that cannot be read, without putting the note in the pillars file', async () => {
    const dir = state(null)
    mkdirSync(join(dir, 'reviews.jsonl'))
    const built = await buildReviewContext(followUp(async () => '', dir))
    expect(built.previousNote).toContain('past-reviews failed')
    expect(readFileSync(built.file as string, 'utf8')).not.toContain('past-reviews failed')
  })

  it('keeps the note when no section is for the pillars', async () => {
    const dir = state(null)
    mkdirSync(join(dir, 'reviews.jsonl'))
    const base = followUp(async () => '', dir)
    const built = await buildReviewContext({ ...base, skillChoice: { selected: [] } })
    expect(built.note).toBe('no section had anything to say')
    expect(built.previousNote).toContain('past-reviews failed')
  })
})

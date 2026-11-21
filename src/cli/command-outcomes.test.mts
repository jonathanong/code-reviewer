import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fakeGh, posted, review, thread } from '../outcomes/github-fake-io.mts'
import { appendRow } from '../tracker/store.mts'
import { createTrackerIo } from '../tracker/io.mts'
import { runReviewCommand } from './command.mts'
import { createDefaultDeps } from './deps.mts'

const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'outcomes-cli-'))
  dirs.push(dir)
  return dir
}

function run(args: string[], env: Record<string, string>, gh = fakeGh({})) {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true))
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true))
  const auth = { mode: 'gh' as const, identity: async () => undefined, runner: () => gh.run }
  return runReviewCommand(
    args,
    createDefaultDeps(() => auth, env),
  ).then((code) => ({
    code,
    out: out.join(''),
    err: err.join(''),
  }))
}

describe('the outcomes subcommand', () => {
  it('records outcomes, reports them as one JSON line, and writes a digest', async () => {
    const state = join(temp(), 'state')
    const tracker = createTrackerIo({ CODE_REVIEWER_STATE_DIR: state })
    const recent = new Date().toISOString()
    appendRow(tracker, posted({ postedAt: recent }))
    const gh = fakeGh({
      7: { reviews: [review(100)], threads: [thread({ id: 1, down: 1 }), thread({ id: 2 })] },
    })
    const env = { CODE_REVIEWER_STATE_DIR: state }
    const found = await run(['outcomes', '--repo', 'acme/widgets'], env, gh)
    expect(found.code).toBe(0)
    expect(JSON.parse(found.out)).toMatchObject({
      pulls: 1,
      findings: 2,
      byOutcome: { rejected: 1, open: 1 },
    })
    const digest = await run(['outcomes', 'digest', '--day', '2026-06-10'], env)
    expect(digest.code).toBe(0)
    const { path } = JSON.parse(digest.out) as { path: string }
    expect(readFileSync(path, 'utf8')).toContain('2 findings recorded')
  })

  it('prints what it could not check on stderr and still succeeds', async () => {
    const state = join(temp(), 'state')
    appendRow(
      createTrackerIo({ CODE_REVIEWER_STATE_DIR: state }),
      posted({ postedAt: new Date().toISOString() }),
    )
    const gh = fakeGh({ 7: { reviews: [], threads: [] } })
    const { code, err } = await run(
      ['outcomes', '--owner', 'acme'],
      { CODE_REVIEWER_STATE_DIR: state },
      gh,
    )
    expect(code).toBe(0)
    expect(err).toContain(
      'code-reviewer: acme/widgets#7: review 100 is no longer on the pull request.',
    )
  })

  it('fails with exit 2 and a message when there is no scope', async () => {
    const { code, err } = await run(['outcomes'], { CODE_REVIEWER_STATE_DIR: join(temp(), 's') })
    expect(code).toBe(2)
    expect(err).toContain('outcomes needs --repo or --owner.')
  })
})

describe('findClone', () => {
  const find = (env: Record<string, string>, clones?: string) =>
    createDefaultDeps(() => {
      throw new Error('no auth')
    }, env).findClone(clones)

  it('finds the clone whose origin is the repository, by --clones or the clone root', async () => {
    const root = temp()
    const dir = join(root, 'anything')
    mkdirSync(dir)
    execFileSync('git', ['init', '-q', dir])
    execFileSync('git', [
      '-C',
      dir,
      'remote',
      'add',
      'origin',
      'https://github.com/acme/widgets.git',
    ])
    expect(await find({}, root)('Acme/Widgets')).toBe(dir)
    expect(await find({ CODE_REVIEWER_CLONE_ROOT: root })('acme/widgets')).toBe(dir)
  })

  it('is undefined without a root, without a clone there, or with a missing root', async () => {
    const root = temp()
    expect(await find({})('acme/widgets')).toBeUndefined()
    expect(await find({}, root)('acme/widgets')).toBeUndefined()
    expect(await find({}, join(root, 'missing'))('acme/widgets')).toBeUndefined()
  })
})

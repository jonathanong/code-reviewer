import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { badRule } from '../issues/issues-fake-io.mts'
import { saveOutcomes } from '../outcomes/store.mts'
import { createTrackerIo } from '../tracker/io.mts'
import { runReviewCommand } from './command.mts'
import { createDefaultDeps } from './deps.mts'

const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(config: string | undefined) {
  const dir = mkdtempSync(join(tmpdir(), 'issues-cli-'))
  dirs.push(dir)
  const state = join(dir, 'state')
  const configs = join(dir, 'configs')
  mkdirSync(configs)
  if (config !== undefined) writeFileSync(join(configs, 'acme.json'), config)
  const now = new Date().toISOString()
  saveOutcomes(
    createTrackerIo({ CODE_REVIEWER_STATE_DIR: state }),
    badRule('a:x').map((row) => ({ ...row, checkedAt: now })),
  )
  return { CODE_REVIEWER_STATE_DIR: state, CODE_REVIEWER_CONFIG_DIR: configs }
}

async function run(args: string[], env: Record<string, string>) {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true))
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true))
  const gh = vi.fn(async (ghArgs: string[]) => (ghArgs[1] === 'list' ? '[]' : 'url\n'))
  const auth = {
    mode: 'gh' as const,
    identity: async () => undefined,
    runner: () => gh,
    modeFor: async () => 'gh' as const,
  }
  const code = await runReviewCommand(
    args,
    createDefaultDeps(() => auth, env),
  )
  return { code, out: out.join(''), err: err.join(''), gh }
}

describe('the issues subcommand', () => {
  it('prints one JSON line, a dry run asking gh only to list', async () => {
    const env = setup(JSON.stringify({ issues: { targets: [{ name: 'a', repo: 'acme/rules' }] } }))
    const { code, out, err, gh } = await run(['issues', '--dry-run'], env)
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual({
      filed: [{ key: 'rule:a:x:review', repo: 'acme/rules', url: null }],
      skipped: [],
      dryRun: true,
    })
    expect(err).toContain('would file in acme/rules')
    expect(gh.mock.calls.map(([args]) => args[1])).toEqual(['list'])
  })

  it('files nothing and succeeds when no issues key is configured', async () => {
    const { code, out, gh } = await run(['issues'], setup(undefined))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ filed: [], dryRun: false })
    expect(gh).not.toHaveBeenCalled()
  })

  it('exits 2 naming the file and key when the config is invalid', async () => {
    const { code, err, out } = await run(
      ['issues'],
      setup('{"issues":{"maxPerDay":0,"targets":[]}}'),
    )
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('acme.json issues.maxPerDay')
  })
})

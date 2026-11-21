import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import { parseRepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import { runReviewCommand } from './command.mts'
import { doctorCommand } from './command-doctor.mts'
import type { ReviewDeps } from './deps.mts'

const dirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const noPlugins: RepoConfigs = {
  byRepo: new Map(),
  byOwner: new Map([['acme', parseRepoConfig('{"rulePlugins": []}', 'acme.json', 'owner')]]),
  problems: [],
}

function deps(answers: Record<string, string>): ReviewDeps {
  return {
    exec: async (command: string) => {
      const answer = answers[command]
      if (answer === undefined) throw new ExecError('missing', 'ENOENT', '', new Error('spawn'))
      return answer
    },
    configs: () => noPlugins,
  } as unknown as ReviewDeps
}

function capture() {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((text) => !!out.push(String(text)))
  vi.spyOn(process.stderr, 'write').mockImplementation((text) => !!err.push(String(text)))
  return { out, err }
}

function env() {
  const home = mkdtempSync(join(tmpdir(), 'doctor-cmd-'))
  dirs.push(home)
  return { HOME: home, CODE_REVIEWER_STATE_DIR: join(home, 'state') }
}

describe('doctor command', () => {
  it('prints lines on stderr and one JSON line on stdout, and exits 0 with no fail', async () => {
    const { out, err } = capture()
    const code = await doctorCommand(
      { owner: 'acme', offline: true },
      deps({ git: 'git 2', gh: 'gh 2', claude: 'claude 2' }),
      env(),
    )
    expect(code).toBe(0)
    expect(out).toHaveLength(1)
    const result = JSON.parse(out[0] as string)
    expect(result).toMatchObject({ fail: 0 })
    expect(result.checks.length).toBe(result.ok + result.warn)
    expect(err.join('')).toContain('ok   node:')
  })

  it('scopes the checks to --repo', async () => {
    const { err } = capture()
    const code = await doctorCommand(
      { repo: ['zed/widgets'], offline: true },
      deps({ git: 'git 2', gh: 'gh 2', claude: 'claude 2' }),
      env(),
    )
    expect(code).toBe(1)
    expect(err.join('')).toContain('could not list plugins')
  })

  it('exits 1 when a check fails', async () => {
    const { out } = capture()
    const code = await doctorCommand({}, deps({ git: 'git 2' }), env())
    expect(code).toBe(1)
    expect(JSON.parse(out[0] as string).fail).toBeGreaterThan(0)
  })

  it('rejects bad flags', async () => {
    const run = (values: Parameters<typeof doctorCommand>[0]) =>
      doctorCommand(values, deps({}), env())
    await expect(run({ repo: ['a/b', 'c/d'] })).rejects.toThrow('at most once')
    await expect(run({ repo: ['a/b'], owner: 'a' })).rejects.toThrow('not both')
    await expect(run({ repo: ['nope'] })).rejects.toThrow('owner/name')
  })

  it('is a subcommand of code-reviewer, and a flag error exits 2', async () => {
    const { err } = capture()
    expect(await runReviewCommand(['doctor', '--repo', 'nope'], deps({}))).toBe(2)
    expect(err.join('')).toContain('--repo must be owner/name.')
  })
})

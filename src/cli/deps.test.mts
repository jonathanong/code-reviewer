import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../review/benchmark/cli.mts', () => ({
  runReviewBenchCli: vi.fn(async () => 5),
}))
vi.mock('../review/benchmark/exec.mts', () => ({
  defaultExec: vi.fn(async () => '[{"id":"rules@m","version":"1.0.0","enabled":true}]'),
}))
vi.mock('../review/benchmark/selection-cli.mts', () => ({
  runReviewSelectionBenchCli: vi.fn(async () => 4),
}))
vi.mock('../review/benchmark/verifier-cli.mts', () => ({
  runReviewVerifierBenchCli: vi.fn(async () => 6),
}))

import { runReviewBenchCli } from '../review/benchmark/cli.mts'
import { defaultExec } from '../review/benchmark/exec.mts'
import { runReviewSelectionBenchCli } from '../review/benchmark/selection-cli.mts'
import { runReviewVerifierBenchCli } from '../review/benchmark/verifier-cli.mts'
import type { GhAuth } from '../gh-cli/index.mts'
import { createDefaultDeps } from './deps.mts'

const SHA = 'a'.repeat(40)
const TARGET = { repo: 'acme/widgets', pr: 4 }

function fakeAuth(mode: GhAuth['mode'] = 'app') {
  const fakeRun = vi.fn(async (args: string[]) => {
    if (args.includes('--paginate')) return 'one\ntwo\n'
    if (args[0] === 'pr') return `${SHA}\n`
    return '[]'
  })
  const runner = vi.fn(() => fakeRun)
  const getAuth = vi.fn((): GhAuth => ({ mode, runner }))
  return { fakeRun, runner, getAuth }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createDefaultDeps', () => {
  it('resolves auth lazily and only once', () => {
    const { getAuth } = fakeAuth('gh')
    const deps = createDefaultDeps(getAuth)
    expect(getAuth).not.toHaveBeenCalled()
    expect(deps.authMode()).toBe('gh')
    expect(deps.authMode()).toBe('gh')
    expect(getAuth).toHaveBeenCalledOnce()
  })

  it('builds the gh ios from a runner for the target repository', async () => {
    const { fakeRun, runner, getAuth } = fakeAuth()
    const deps = createDefaultDeps(getAuth)
    await expect(deps.createIo(TARGET).headSha()).resolves.toBe(SHA)
    expect(runner).toHaveBeenLastCalledWith('acme', 'widgets')
    await expect(deps.createLabelIo(TARGET).labels()).resolves.toEqual(['one', 'two'])
    expect(runner).toHaveBeenCalledTimes(2)
    await expect(deps.createPrepareIo(TARGET).files()).resolves.toEqual([])
    expect(runner).toHaveBeenCalledTimes(3)
    expect(fakeRun).toHaveBeenCalledTimes(3)
    expect(getAuth).toHaveBeenCalledOnce()
  })

  it('passes the trusted-author allowlist to the gh ios', async () => {
    const { getAuth } = fakeAuth()
    const deps = createDefaultDeps(getAuth, { FINAL_REVIEWER_TRUSTED_AUTHORS: 'App[bot], Me' })
    await expect(deps.createIo(TARGET).trustedAuthors()).resolves.toEqual(
      new Set(['app[bot]', 'me']),
    )
    await expect(deps.createPrepareIo(TARGET).trusted()).resolves.toEqual(
      new Set(['app[bot]', 'me']),
    )
  })

  it('reads the configs once from the config directory and labels the approval from them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deps-configs-'))
    try {
      writeFileSync(join(dir, 'acme.json'), '{"labels":{"approval":"lgtm"}}')
      const getAuth = vi.fn((): GhAuth => ({ mode: 'gh', runner: () => async () => 'lgtm\n' }))
      const deps = createDefaultDeps(getAuth, { FINAL_REVIEWER_CONFIG_DIR: dir })
      expect(deps.configs().byOwner.get('acme')?.labels).toEqual({ approval: 'lgtm' })
      expect(deps.configs()).toBe(deps.configs())
      await expect(deps.createIo(TARGET).hasApprovalLabel()).resolves.toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes the runner through', () => {
    const { fakeRun, runner, getAuth } = fakeAuth()
    const deps = createDefaultDeps(getAuth)
    expect(deps.runner('acme')).toBe(fakeRun)
    expect(runner).toHaveBeenCalledWith('acme', undefined)
    expect(deps.runner('acme', 'widgets')).toBe(fakeRun)
    expect(runner).toHaveBeenLastCalledWith('acme', 'widgets')
  })

  it('defaults to the environment-based auth', () => {
    vi.stubEnv('FINAL_REVIEWER_APP_ID', '')
    expect(createDefaultDeps().authMode()).toBe('gh')
    vi.unstubAllEnvs()
  })

  it('reads real files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deps-'))
    try {
      const file = join(dir, 'in.json')
      writeFileSync(file, '{"a":1}')
      expect(createDefaultDeps(fakeAuth().getAuth).readFile(file)).toBe('{"a":1}')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists the enabled Claude Code plugins', async () => {
    const deps = createDefaultDeps(fakeAuth().getAuth)
    await expect(deps.listPlugins()).resolves.toEqual([{ id: 'rules@m', version: '1.0.0' }])
    expect(defaultExec).toHaveBeenCalledWith('claude', ['plugin', 'list', '--json'])
  })

  it('lists enabled plugins with their install paths in one call', async () => {
    vi.mocked(defaultExec).mockResolvedValueOnce(
      '[{"id":"skills@m","version":"1.0.0","enabled":true,"scope":"user","installPath":"/p/skills"}]',
    )
    const deps = createDefaultDeps(fakeAuth().getAuth)
    await expect(deps.pluginInfo()).resolves.toEqual({
      enabled: [{ id: 'skills@m', version: '1.0.0' }],
      installs: [{ name: 'skills', installPath: '/p/skills' }],
    })
    expect(defaultExec).toHaveBeenCalledTimes(1)
  })

  it('runs a binary through the default exec and locates the references', async () => {
    const deps = createDefaultDeps(fakeAuth().getAuth)
    await deps.exec('claude', ['-p', 'x'], { cwd: '/tree', timeoutMs: 5 })
    expect(defaultExec).toHaveBeenCalledWith('claude', ['-p', 'x'], { cwd: '/tree', timeoutMs: 5 })
    expect(deps.references().endsWith('skills/review/references')).toBe(true)
  })

  it('delegates the benchmarks', async () => {
    const deps = createDefaultDeps(fakeAuth().getAuth)
    await expect(deps.runBench(['--x'])).resolves.toBe(5)
    expect(runReviewBenchCli).toHaveBeenCalledWith(['--x'])
    await expect(deps.runVerifierBench(['--y'])).resolves.toBe(6)
    expect(runReviewVerifierBenchCli).toHaveBeenCalledWith(['--y'])
    await expect(deps.runSelectionBench(['--z'])).resolves.toBe(4)
    expect(runReviewSelectionBenchCli).toHaveBeenCalledWith(['--z'])
  })
})

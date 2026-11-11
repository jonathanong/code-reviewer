import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../final-review/benchmark/cli.mts', () => ({
  runFinalReviewBenchCli: vi.fn(async () => 5),
}))
vi.mock('../final-review/benchmark/verifier-cli.mts', () => ({
  runFinalReviewVerifierBenchCli: vi.fn(async () => 6),
}))

import { runFinalReviewBenchCli } from '../final-review/benchmark/cli.mts'
import { runFinalReviewVerifierBenchCli } from '../final-review/benchmark/verifier-cli.mts'
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
    await expect(deps.createPrepareIo(TARGET).paths()).resolves.toEqual([])
    expect(runner).toHaveBeenCalledTimes(3)
    expect(fakeRun).toHaveBeenCalledTimes(3)
    expect(getAuth).toHaveBeenCalledOnce()
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

  it('delegates the benchmarks', async () => {
    const deps = createDefaultDeps(fakeAuth().getAuth)
    await expect(deps.runBench(['--x'])).resolves.toBe(5)
    expect(runFinalReviewBenchCli).toHaveBeenCalledWith(['--x'])
    await expect(deps.runVerifierBench(['--y'])).resolves.toBe(6)
    expect(runFinalReviewVerifierBenchCli).toHaveBeenCalledWith(['--y'])
  })
})

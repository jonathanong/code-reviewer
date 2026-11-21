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
import { AppAuthError, type GhAuth } from '../gh-cli/index.mts'
import { createDefaultDeps } from './deps.mts'

const SHA = 'a'.repeat(40)
const TARGET = { repo: 'acme/widgets', pr: 4 }

function fakeAuth(
  mode: GhAuth['mode'] = 'app',
  identity: GhAuth['identity'] = async () => undefined,
) {
  const fakeRun = vi.fn(async (args: string[]) => {
    if (args.includes('--paginate')) return 'one\ntwo\n'
    if (args[0] === 'pr') return `${SHA}\n`
    return '[]'
  })
  const runner = vi.fn(() => fakeRun)
  const getAuth = vi.fn((): GhAuth => ({ mode, identity, runner }))
  return { fakeRun, runner, getAuth }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createDefaultDeps', () => {
  it('keeps the tracker in the state directory, apart from the config directory', () => {
    const { getAuth } = fakeAuth()
    const state = createDefaultDeps(getAuth, {
      CODE_REVIEWER_STATE_DIR: '/state/here',
      CODE_REVIEWER_CONFIG_DIR: '/config/here',
    }).tracker()
    expect(state.dir).toBe('/state/here')
    expect(createDefaultDeps(getAuth, { XDG_STATE_HOME: '/xdg' }).tracker().dir).toBe(
      '/xdg/code-reviewer',
    )
  })

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

  it('trusts the own identity under App auth, in both gh ios', async () => {
    const { getAuth } = fakeAuth('app', async () => 'App[bot]')
    const deps = createDefaultDeps(getAuth, {})
    await expect(deps.createIo(TARGET).trustedAuthors()).resolves.toEqual(new Set(['app[bot]']))
    await expect(deps.createPrepareIo(TARGET).trusted()).resolves.toEqual(new Set(['app[bot]']))
  })

  it('reports the identity, or why nothing is trusted', async () => {
    const app = fakeAuth('app', async () => 'App[bot]')
    const found = createDefaultDeps(() => ({ ...app.getAuth(), source: '/cfg/app.json' }), {})
    await expect(found.authIdentity()).resolves.toEqual({
      source: '/cfg/app.json',
      login: 'App[bot]',
    })
    const gh = createDefaultDeps(fakeAuth('gh').getAuth, {})
    await expect(gh.authIdentity()).resolves.toEqual({})
    const failed = async () => {
      throw new AppAuthError('GET /app failed with 401.')
    }
    const lost = await createDefaultDeps(fakeAuth('app', failed).getAuth, {}).authIdentity()
    expect(lost).toEqual({ loginError: expect.stringContaining('no review marker is trusted') })
    const odd = async () => {
      throw 'boom'
    }
    await expect(
      createDefaultDeps(fakeAuth('app', odd).getAuth, {}).authIdentity(),
    ).resolves.toEqual({ loginError: expect.stringContaining('boom') })
  })

  it('reads the configs once from the config directory and labels the approval from them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deps-configs-'))
    try {
      writeFileSync(join(dir, 'acme.json'), '{"labels":{"approval":"lgtm"}}')
      const getAuth = vi.fn((): GhAuth => ({
        mode: 'gh',
        identity: async () => undefined,
        runner: () => async (args) => {
          if (args[0] === 'api') throw new Error('HTTP 404')
          return 'lgtm\n'
        },
      }))
      const deps = createDefaultDeps(getAuth, { CODE_REVIEWER_CONFIG_DIR: dir })
      expect(deps.configs().byOwner.get('acme')?.labels).toEqual({ approval: 'lgtm' })
      expect(deps.configs()).toBe(deps.configs())
      await expect(deps.createIo(TARGET).hasApprovalLabel()).resolves.toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads a repository file once per repository and labels the approval from it', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args.at(-1)?.endsWith('/contents')) return '.code-reviewer.json\n'
      if (args[0] === 'api') return '{"labels":{"approval":"own lgtm"}}'
      return 'own lgtm\n'
    })
    const getAuth = vi.fn((): GhAuth => ({
      mode: 'gh',
      identity: async () => undefined,
      runner: () => run,
    }))
    const deps = createDefaultDeps(getAuth, { CODE_REVIEWER_CONFIG_DIR: '/nowhere/configs' })
    await expect(deps.createIo(TARGET).hasApprovalLabel()).resolves.toBe(true)
    await expect(deps.createIo(TARGET).hasApprovalLabel()).resolves.toBe(true)
    const first = await deps.targetConfig('Acme/Widgets')
    expect(first.config?.labels).toEqual({ approval: 'own lgtm' })
    expect(await deps.targetConfig('acme/widgets')).toBe(first)
    const reads = run.mock.calls.filter(([args]) => args[0] === 'api')
    expect(reads).toHaveLength(2)
    expect(reads[0]?.[0].at(-1)).toBe('repos/acme/widgets/contents')
    expect(reads[1]?.[0].at(-1)).toBe('repos/acme/widgets/contents/.code-reviewer.json')
  })

  it('treats an absent repository file as no config and a failed read as a problem', async () => {
    const failures: Record<string, string> = {
      'a/none': 'gh: Not Found (HTTP 404)',
      'a/bad': 'HTTP 500',
    }
    const run = vi.fn(async (args: string[]): Promise<string> => {
      const repo = /repos\/(a\/\w+)\//u.exec(args.at(-1) ?? '')?.[1] ?? ''
      throw new Error(failures[repo])
    })
    const deps = createDefaultDeps(
      () => ({ mode: 'gh', identity: async () => undefined, runner: () => run }),
      {
        CODE_REVIEWER_CONFIG_DIR: '/nowhere/configs',
      },
    )
    await expect(deps.targetConfig('a/none')).resolves.toEqual({ config: undefined, problems: [] })
    await expect(deps.targetConfig('a/bad')).resolves.toEqual({
      config: undefined,
      problems: [
        'a/bad/.code-reviewer{.json,.jsonc,.yaml,.yml}: could not be read (HTTP 500); ignored',
      ],
    })
  })

  it('degrades to a problem when no gh auth can be built', async () => {
    const getAuth = vi.fn((): GhAuth => {
      throw new Error('no credentials')
    })
    const deps = createDefaultDeps(getAuth, { CODE_REVIEWER_CONFIG_DIR: '/nowhere' })
    await expect(deps.targetConfig('a/b')).resolves.toEqual({
      config: undefined,
      problems: [
        'a/b/.code-reviewer{.json,.jsonc,.yaml,.yml}: could not be read (no credentials); ignored',
      ],
    })
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
    vi.stubEnv('CODE_REVIEWER_APP_ID', '')
    vi.stubEnv('XDG_CONFIG_HOME', '/nonexistent')
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

  it('reads repository guides from the given clone root, else the environment one', async () => {
    const guide = { repo: 'acme/ops', path: 'docs/data.md' }
    const none = createDefaultDeps(fakeAuth().getAuth, {}).guideReader(undefined)
    await expect(none(guide)).rejects.toThrow('no clone root')
    const env = { CODE_REVIEWER_CLONE_ROOT: '/nowhere/env-clones' }
    const deps = createDefaultDeps(fakeAuth().getAuth, env)
    await expect(deps.guideReader(undefined)(guide)).rejects.toThrow('/nowhere/env-clones')
    await expect(deps.guideReader('/nowhere/flag-clones')(guide)).rejects.toThrow(
      '/nowhere/flag-clones',
    )
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

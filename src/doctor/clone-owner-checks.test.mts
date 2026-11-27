import { describe, expect, it, vi } from 'vitest'

import { AppNotInstalledError, type AppConfig } from '../gh-cli/index.mts'
import { NO_CONFIGS, type RepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import { cloneOwnerChecks, githubOwner } from './clone-owner-checks.mts'
import { fakeIo, notFound, type FakeOptions } from './doctor-fake-io.mts'
import type { DoctorFlags } from './types.mts'

const flags: DoctorFlags = { offline: false }
const APP = { source: 'env' } as unknown as AppConfig
const origin = (dir: string) => `git -C /clones/${dir} remote get-url origin`

const configs = (owners: string[], repos: string[] = []): RepoConfigs => ({
  ...NO_CONFIGS,
  byOwner: new Map(owners.map((owner) => [owner, {} as RepoConfig])),
  byRepo: new Map(repos.map((repo) => [repo, {} as RepoConfig])),
})

function setup(options: FakeOptions & { clones?: string } = {}) {
  const dirs = options.dirs ?? { '/clones': ['old', 'new', 'loose', 'other'] }
  return fakeIo({
    env: { CODE_REVIEWER_CLONE_ROOT: '/clones' },
    ...options,
    dirs,
    mtimes: {
      '/clones/old/.git': 1,
      '/clones/new/.git': 1,
      '/clones/other/.git': 1,
      ...options.mtimes,
    },
    exec: {
      [origin('old')]: 'git@github.com:jonathanong/old.git\n',
      [origin('new')]: 'https://github.com/Jongleberry/new\n',
      [origin('other')]: 'https://gitlab.com/x/other.git\n',
      ...options.exec,
    },
  })
}

describe('githubOwner', () => {
  it.each([
    ['git@github.com:acme/w.git', 'acme'],
    ['https://github.com/acme/w', 'acme'],
    ['https://github.com/acme/w.git/', 'acme'],
    ['ssh://git@github.com/acme/w.git', 'acme'],
  ])('reads the owner of %s', (url, owner) => expect(githubOwner(url)).toBe(owner))

  it('ignores another host', () => expect(githubOwner('https://gitlab.com/acme/w')).toBeUndefined())
})

describe('cloneOwnerChecks', () => {
  it('checks nothing without a clone root, or when the root is missing', async () => {
    const none = fakeIo()
    expect(await cloneOwnerChecks({ io: none.io, flags })).toEqual([])
    const missing = fakeIo({ env: { CODE_REVIEWER_CLONE_ROOT: '/clones' } })
    expect(await cloneOwnerChecks({ io: missing.io, flags })).toEqual([])
    expect(missing.exec).not.toHaveBeenCalled()
  })

  it('warns for an owner with no machine config, and takes --clones over the environment', async () => {
    const { io } = setup({
      env: { CODE_REVIEWER_CLONE_ROOT: '/elsewhere' },
      io: { configs: () => configs(['jonathanong']) },
    })
    const checks = await cloneOwnerChecks({ io, flags: { ...flags, clones: '/clones' } })
    expect(checks).toEqual([
      {
        name: 'clone-owner:Jongleberry',
        status: 'warn',
        detail:
          'Jongleberry (clones: new): no owner config file for it, so its other repositories run on built-in defaults',
        fix: 'add /cfg/repos/Jongleberry.yaml (or .json) for Jongleberry',
      },
    ])
  })

  it('counts an owner file in any case, but not per-repository files alone', async () => {
    const byOwner = setup({ io: { configs: () => configs(['jongleberry', 'jonathanong']) } })
    expect((await cloneOwnerChecks({ io: byOwner.io, flags }))[0]).toMatchObject({
      name: 'clone-owners',
      status: 'ok',
      detail: '2 clones under /clones, for 2 GitHub owners, all set up',
    })
    const byRepo = setup({
      io: { configs: () => configs(['jonathanong'], ['jongleberry/new']) },
    })
    expect(await cloneOwnerChecks({ io: byRepo.io, flags })).toEqual([
      expect.objectContaining({
        name: 'clone-owner:Jongleberry',
        detail:
          'Jongleberry (clones: new): no owner config file for it, so its other repositories run on built-in defaults',
      }),
    ])
  })

  it('warns when the App is configured but not installed, one lookup per owner', async () => {
    const checkInstallation = vi.fn(async (owner: string) => {
      if (owner === 'jonathanong') return
      throw new AppNotInstalledError('x', undefined, undefined)
    })
    const { io } = setup({
      dirs: { '/clones': ['old', 'new', 'dup'] },
      mtimes: { '/clones/dup/.git': 1 },
      exec: { [origin('dup')]: 'git@github.com:Jongleberry/dup.git' },
      io: {
        loadApp: () => APP,
        checkInstallation,
        configs: () => configs(['jonathanong', 'jongleberry']),
      },
    })
    const checks = await cloneOwnerChecks({ io, flags })
    expect(checks).toEqual([
      {
        name: 'clone-owner:Jongleberry',
        status: 'warn',
        detail:
          'Jongleberry (clones: dup, new): the GitHub App is configured but not installed for it',
        fix: 'install the App for Jongleberry',
      },
    ])
    expect(checkInstallation).toHaveBeenCalledTimes(2)
  })

  it('reports both problems on one owner, and a failed lookup as a warn', async () => {
    const { io } = setup({
      io: {
        loadApp: () => APP,
        checkInstallation: async (owner) => {
          if (owner === 'jonathanong') throw new Error('HTTP 502\nmore')
          throw new AppNotInstalledError('x', undefined, undefined)
        },
      },
    })
    const checks = await cloneOwnerChecks({ io, flags })
    expect(checks.map((check) => check.status)).toEqual(['warn', 'warn'])
    expect(checks[0]).toMatchObject({
      name: 'clone-owner:jonathanong',
      detail:
        'jonathanong (clones: old): no owner config file for it, so its other repositories run on built-in defaults; could not check the GitHub App installation: HTTP 502',
    })
    expect(checks[1]?.fix).toBe(
      'add /cfg/repos/Jongleberry.yaml (or .json) for Jongleberry; install the App for Jongleberry',
    )
  })

  it('makes no installation lookup offline, without an App, or with an App config that is wrong', async () => {
    const checkInstallation = vi.fn(async () => undefined)
    const all = configs(['jonathanong', 'jongleberry'])
    const bad = () => {
      throw new Error('bad key')
    }
    for (const [offline, loadApp] of [
      [true, () => APP],
      [false, () => undefined],
      [false, bad],
    ] as const) {
      const { io } = setup({ io: { loadApp, checkInstallation, configs: () => all } })
      const checks = await cloneOwnerChecks({ io, flags: { offline } })
      expect(checks[0]).toMatchObject({ status: 'ok' })
    }
    expect(checkInstallation).not.toHaveBeenCalled()
  })

  it('skips the config comparison when the config cannot be read', async () => {
    const { io } = setup({
      io: {
        configs: () => {
          throw new Error('EACCES')
        },
      },
    })
    expect(await cloneOwnerChecks({ io, flags })).toEqual([
      {
        name: 'clone-owners',
        status: 'ok',
        detail: '2 clones under /clones, for 2 GitHub owners, all set up',
      },
    ])
  })

  it('warns naming the path of a clone whose origin cannot be read, and never says all set up', async () => {
    const { io } = setup({
      exec: { [origin('new')]: notFound('git') },
      io: { configs: () => configs(['jonathanong']) },
    })
    expect(await cloneOwnerChecks({ io, flags })).toEqual([
      {
        name: 'clone-remote:/clones/new',
        status: 'warn',
        detail: 'could not read the origin remote of /clones/new, so its owner is unchecked',
        fix: 'git -C /clones/new remote get-url origin',
      },
    ])
  })

  it('says clone and owner in the singular for one', async () => {
    const { io } = setup({
      dirs: { '/clones': ['old'] },
      io: { configs: () => configs(['jonathanong']) },
    })
    expect(await cloneOwnerChecks({ io, flags })).toEqual([
      expect.objectContaining({ detail: '1 clone under /clones, for 1 GitHub owner, all set up' }),
    ])
  })

  it('skips a clone on another host without a warning', async () => {
    const { io } = setup({
      dirs: { '/clones': ['other'] },
      io: { configs: () => configs([]) },
    })
    expect(await cloneOwnerChecks({ io, flags })).toEqual([
      {
        name: 'clone-owners',
        status: 'ok',
        detail: '0 clones under /clones, for 0 GitHub owners, all set up',
      },
    ])
  })
})

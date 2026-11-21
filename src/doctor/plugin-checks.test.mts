import { describe, expect, it } from 'vitest'

import { parseRepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import { DAY, fakeIo, listing, NOW, type FakeOptions } from './doctor-fake-io.mts'
import { REMOTE_TIMEOUT_MS, STALE_AFTER_DAYS } from './freshness.mts'
import { pluginChecks } from './plugin-checks.mts'
import { PROBE_TIMEOUT_MS } from './probe.mts'

const LIST = 'claude plugin list --json'
const MARKETS = '/home/.claude/plugins/known_marketplaces.json'
const SHA_OLD = 'a'.repeat(40)
const SHA_NEW = 'b'.repeat(40)

const markets = JSON.stringify({
  m: { source: { source: 'github', repo: 'acme/rules' } },
  g: { source: { source: 'git', url: 'https://git.example/acme/jong.git' } },
})

const skills = {
  '/plugins/no-mistakes-rules/skills': ['a', 'b'],
  '/plugins/jong-skills/skills': ['c'],
}

function setup(options: FakeOptions & { list?: string }) {
  const { list, ...rest } = options
  return fakeIo({
    ...rest,
    exec: {
      [LIST]: list ?? listing({ id: 'no-mistakes-rules@m' }, { id: 'jong-skills@g' }),
      ...rest.exec,
    },
    dirs: { ...skills, ...rest.dirs },
    files: { [MARKETS]: markets, ...rest.files },
  })
}

const run = (fake: ReturnType<typeof setup>, offline = false, extra = {}) =>
  pluginChecks({ io: fake.io, flags: { offline, ...extra } })

const byName = (checks: Awaited<ReturnType<typeof run>>, name: string) =>
  checks.find((check) => check.name === name)

describe('rule plugins', () => {
  it('is ok for each default plugin that is installed with skills', async () => {
    const checks = await run(setup({}), true)
    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ['rule-plugin:no-mistakes-rules', 'ok'],
      ['plugin-freshness:no-mistakes-rules', 'ok'],
      ['rule-plugin:jong-skills', 'ok'],
      ['plugin-freshness:jong-skills', 'ok'],
    ])
  })

  it('fails a plugin that is not enabled at user scope, with the install command', async () => {
    const fake = setup({ list: listing({ id: 'no-mistakes-rules@m' }) })
    const checks = await run(fake, true)
    expect(byName(checks, 'rule-plugin:jong-skills')).toMatchObject({
      status: 'fail',
      fix: 'claude plugin install jong-skills --scope user',
    })
    expect(byName(checks, 'plugin-freshness:jong-skills')).toBeUndefined()
  })

  it('ignores a plugin enabled only at project scope', async () => {
    const project = JSON.stringify([
      { id: 'jong-skills@g', scope: 'project', enabled: true, installPath: '/p' },
      {
        id: 'no-mistakes-rules@m',
        scope: 'user',
        enabled: true,
        installPath: '/plugins/no-mistakes-rules',
      },
    ])
    const checks = await run(setup({ list: project }), true)
    expect(byName(checks, 'rule-plugin:jong-skills')?.status).toBe('fail')
  })

  it('warns when an installed plugin holds no skills', async () => {
    const fake = setup({ dirs: { '/plugins/jong-skills/skills': [] } })
    const checks = await run(fake, true)
    expect(byName(checks, 'rule-plugin:jong-skills')).toMatchObject({
      status: 'warn',
      fix: 'claude plugin update jong-skills',
    })
    const gone = setup({ dirs: { '/plugins/jong-skills/skills': undefined as never } })
    expect(byName(await run(gone, true), 'rule-plugin:jong-skills')?.status).toBe('warn')
  })

  it('fails when claude cannot list plugins, and says how to see why', async () => {
    const fake = setup({ exec: { [LIST]: new Error('timed out') } })
    expect(await run(fake, true)).toEqual([
      {
        name: 'rule-plugins',
        status: 'fail',
        detail: 'could not list plugins: timed out',
        fix: 'claude plugin list --json',
      },
    ])
    expect(fake.exec).toHaveBeenCalledWith('claude', ['plugin', 'list', '--json'], {
      timeoutMs: PROBE_TIMEOUT_MS * 2,
    })
  })

  it('fails when the machine config cannot be resolved', async () => {
    const fake = setup({
      io: {
        configs: () => {
          throw new Error('unreadable')
        },
      },
    })
    expect((await run(fake))[0]).toMatchObject({ name: 'rule-plugins', status: 'fail' })
  })

  it('is ok with no plugin when the scope sets an empty rulePlugins list', async () => {
    const owner = parseRepoConfig('{"rulePlugins": []}', 'acme.json', 'owner')
    const configs: RepoConfigs = {
      byRepo: new Map(),
      byOwner: new Map([['acme', owner]]),
      problems: [],
    }
    const fake = setup({ io: { configs: () => configs } })
    const checks = await run(fake, false, { owner: 'acme' })
    expect(checks).toEqual([
      { name: 'rule-plugins', status: 'ok', detail: 'none configured; repository rules only' },
    ])
    expect(fake.exec).not.toHaveBeenCalled()
  })
})

describe('plugin freshness', () => {
  const aged = (days: number) => ({
    mtimes: { '/plugins/no-mistakes-rules': NOW.getTime() - days * DAY },
  })
  const rules = (checks: Awaited<ReturnType<typeof run>>) =>
    byName(checks, 'plugin-freshness:no-mistakes-rules')

  it('is ok at the age limit and reports version and age', async () => {
    const fake = setup({
      ...aged(STALE_AFTER_DAYS),
      list: listing({ id: 'no-mistakes-rules@m', version: '1.2.3' }),
    })
    expect(rules(await run(fake, true))).toEqual({
      name: 'plugin-freshness:no-mistakes-rules',
      status: 'ok',
      detail: 'installed 1.2.3; install directory modified 14 days ago',
    })
  })

  it('warns past the age limit with the update command, offline', async () => {
    const fake = setup({ ...aged(STALE_AFTER_DAYS + 1) })
    const check = rules(await run(fake, true))
    expect(check).toMatchObject({
      status: 'warn',
      fix: 'claude plugin update no-mistakes-rules',
    })
    expect(check?.detail).toContain('older than 14 days')
    expect(fake.exec).not.toHaveBeenCalledWith('git', expect.anything(), expect.anything())
  })

  it('notes an install directory whose time cannot be read', async () => {
    const list = listing({ id: 'no-mistakes-rules@m', installPath: '/elsewhere' })
    const check = rules(await run(setup({ list }), true))
    expect(check).toMatchObject({ status: 'ok' })
    expect(check?.detail).toContain('install directory time unknown')
  })

  describe('online, for an install that records a commit', () => {
    const list = (record: object) =>
      listing({ id: 'no-mistakes-rules@m', ...record }, { id: 'jong-skills@g', sha: SHA_OLD })
    const remote = (sha: string) => `${sha}\tHEAD\n`
    const only = (record: object) =>
      listing({ id: 'no-mistakes-rules@m', ...record }, { id: 'jong-skills@g' })
    const lsRemote = 'git ls-remote https://github.com/acme/rules.git HEAD'

    it('warns when the remote HEAD moved, naming both commits', async () => {
      const fake = setup({
        list: list({ sha: SHA_OLD }),
        exec: {
          [lsRemote]: remote(SHA_NEW),
          'git ls-remote https://git.example/acme/jong.git HEAD': remote(SHA_OLD),
        },
      })
      const checks = await run(fake)
      expect(rules(checks)).toMatchObject({
        status: 'warn',
        detail: expect.stringContaining('behind: installed aaaaaaa, latest bbbbbbb'),
        fix: 'claude plugin update no-mistakes-rules',
      })
      expect(byName(checks, 'plugin-freshness:jong-skills')?.status).toBe('ok')
      expect(fake.exec).toHaveBeenCalledWith(
        'git',
        ['ls-remote', 'https://github.com/acme/rules.git', 'HEAD'],
        { timeoutMs: REMOTE_TIMEOUT_MS },
      )
    })

    it('is ok when the remote HEAD is the installed commit, abbreviated or not', async () => {
      const fake = setup({
        list: list({ version: SHA_OLD.slice(0, 12) }),
        exec: { [lsRemote]: remote(SHA_OLD) },
      })
      expect(rules(await run(fake))).toMatchObject({ status: 'ok' })
    })

    it('warns, never fails, when the remote cannot be reached or times out', async () => {
      const fake = setup({
        list: list({ sha: SHA_OLD }),
        exec: { [lsRemote]: new Error('timed out') },
      })
      const check = rules(await run(fake))
      expect(check).toMatchObject({ status: 'warn' })
      expect(check?.detail).toContain('could not check the remote: timed out')
      expect(check?.fix).toBe('claude plugin update no-mistakes-rules')
    })

    it('warns when the remote lists no HEAD', async () => {
      const fake = setup({ list: list({ sha: SHA_OLD }), exec: { [lsRemote]: '\n' } })
      expect(rules(await run(fake))?.detail).toContain('could not check: remote listed no HEAD')
    })

    it('makes no network call with --offline', async () => {
      const fake = setup({ list: list({ sha: SHA_OLD }), exec: { [lsRemote]: remote(SHA_NEW) } })
      expect(rules(await run(fake, true))?.status).toBe('ok')
      expect(fake.exec).not.toHaveBeenCalledWith('git', expect.anything(), expect.anything())
    })

    it('makes no call when no remote is recorded or the install has no commit', async () => {
      const noFile = setup({
        list: only({ sha: SHA_OLD }),
        files: { [MARKETS]: undefined as never },
      })
      const noMarket = setup({
        list: listing({ id: 'no-mistakes-rules@unknown', sha: SHA_OLD }, { id: 'jong-skills@g' }),
      })
      const bad = setup({ list: only({ sha: SHA_OLD }), files: { [MARKETS]: '{nope' } })
      const versionOnly = setup({ list: only({ version: '1.2.3' }) })
      const noMarketplace = setup({
        list: listing({ id: 'no-mistakes-rules', sha: SHA_OLD }, { id: 'jong-skills@g' }),
      })
      for (const fake of [noFile, noMarket, bad, versionOnly, noMarketplace]) {
        expect(rules(await run(fake))?.status).toBe('ok')
        expect(fake.exec).not.toHaveBeenCalledWith('git', expect.anything(), expect.anything())
      }
    })
  })
})

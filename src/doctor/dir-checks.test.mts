import { describe, expect, it } from 'vitest'

import { parseRepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import { cloneCheck, configCheck, dirChecks } from './dir-checks.mts'
import { fakeIo } from './doctor-fake-io.mts'

const flags = { offline: false }

describe('tracker and tmp directories', () => {
  const run = (options: Parameters<typeof fakeIo>[0]) =>
    dirChecks({ io: fakeIo(options).io, flags })

  it('is ok when both exist and are writable', () => {
    const checks = run({ dirs: { '/state/code-reviewer': [], '/tmp': [] } })
    expect(checks.map((check) => check.status)).toEqual(['ok', 'ok'])
  })

  it('is ok when the tracker directory is missing but its nearest parent is writable', () => {
    const [tracker] = run({ dirs: { '/state': [], '/tmp': [] } })
    expect(tracker).toMatchObject({ status: 'ok' })
    expect(tracker?.detail).toContain('does not exist yet; /state is writable')
  })

  it('fails with the fix when the directory is not writable', () => {
    const [tracker] = run({
      dirs: { '/state/code-reviewer': [], '/tmp': [] },
      unwritable: ['/state/code-reviewer'],
    })
    expect(tracker).toMatchObject({ status: 'fail', fix: 'chmod u+w /state/code-reviewer' })
  })

  it('fails when a missing directory cannot be created', () => {
    const [tracker] = run({ dirs: { '/state': [], '/tmp': [] }, unwritable: ['/state'] })
    expect(tracker).toMatchObject({ status: 'fail', fix: 'mkdir -p /state/code-reviewer' })
  })

  it('walks up to the root when no ancestor exists', () => {
    const [tracker] = run({ unwritable: ['/'] })
    expect(tracker?.status).toBe('fail')
    expect(tracker?.detail).toContain('/ is not writable')
  })

  it('fails when the path is a file', () => {
    const [tracker] = run({ files: { '/state/code-reviewer': 'x' }, dirs: { '/tmp': [] } })
    expect(tracker).toMatchObject({ status: 'fail', fix: 'rm /state/code-reviewer' })
  })
})

describe('machine config', () => {
  const configs = (...texts: Array<[string, string, 'owner' | 'repo']>): RepoConfigs => ({
    byRepo: new Map(),
    byOwner: new Map(),
    problems: texts.flatMap(([file, text, scope]) => parseRepoConfig(text, file, scope).problems),
  })
  const broken = configs(
    ['acme.json', '{"bogus": 1}', 'owner'],
    ['zed.json', '{"bogus": 1}', 'owner'],
  )

  it('is ok with no problems', () => {
    const { io } = fakeIo()
    expect(configCheck({ io, flags })).toMatchObject({ status: 'ok' })
  })

  it('fails with every problem when no scope is given', () => {
    const { io } = fakeIo({ io: { configs: () => broken } })
    const check = configCheck({ io, flags })
    expect(broken.problems).toHaveLength(2)
    expect(check.status).toBe('fail')
    for (const problem of broken.problems) expect(check.detail).toContain(problem)
  })

  it('prints only the problems of the --owner or --repo scope', () => {
    const { io } = fakeIo({ io: { configs: () => broken } })
    const owner = configCheck({ io, flags: { ...flags, owner: 'acme' } })
    expect(owner.status).toBe('fail')
    expect(owner.detail).toContain('acme')
    expect(owner.detail).not.toContain('zed')
    expect(configCheck({ io, flags: { ...flags, repo: 'zed/app' } }).detail).toContain('zed')
    expect(configCheck({ io, flags: { ...flags, owner: 'other' } }).status).toBe('ok')
  })

  it('fails when the directory cannot be read', () => {
    const { io } = fakeIo({
      io: {
        configs: () => {
          throw new Error('EACCES: permission denied')
        },
      },
    })
    expect(configCheck({ io, flags })).toMatchObject({
      status: 'fail',
      detail: 'cannot read /cfg/repos: EACCES: permission denied',
    })
  })
})

describe('clone root', () => {
  it('is ok and optional when unset', async () => {
    const { io } = fakeIo()
    expect(await cloneCheck({ io, flags })).toMatchObject({ status: 'ok' })
  })

  it('warns when the root is not a directory', async () => {
    const { io } = fakeIo({ env: { CODE_REVIEWER_CLONE_ROOT: '/clones' } })
    expect(await cloneCheck({ io, flags })).toMatchObject({
      status: 'warn',
      fix: 'mkdir -p /clones, or unset CODE_REVIEWER_CLONE_ROOT',
    })
    const file = fakeIo({ env: { CODE_REVIEWER_CLONE_ROOT: '/clones' }, files: { '/clones': '' } })
    expect((await cloneCheck({ io: file.io, flags })).status).toBe('warn')
  })

  it('is ok without --repo when the root exists', async () => {
    const { io } = fakeIo({ env: { CODE_REVIEWER_CLONE_ROOT: '/clones' }, dirs: { '/clones': [] } })
    expect(await cloneCheck({ io, flags })).toMatchObject({
      status: 'ok',
      detail: '/clones exists',
    })
  })

  it('reports whether --repo has a clone', async () => {
    const base = { env: { CODE_REVIEWER_CLONE_ROOT: '/clones' }, dirs: { '/clones': [] } }
    const withClone = fakeIo({
      ...base,
      io: { findClone: async () => '/clones/widgets' },
    })
    const scoped = { offline: false, repo: 'acme/widgets' }
    expect((await cloneCheck({ io: withClone.io, flags: scoped })).detail).toBe(
      'acme/widgets is cloned at /clones/widgets',
    )
    const none = fakeIo(base)
    expect((await cloneCheck({ io: none.io, flags: scoped })).detail).toContain(
      'no clone of acme/widgets',
    )
  })

  it('warns when the search fails', async () => {
    const { io } = fakeIo({
      env: { CODE_REVIEWER_CLONE_ROOT: '/clones' },
      dirs: { '/clones': [] },
      io: {
        findClone: async () => {
          throw new Error('EACCES')
        },
      },
    })
    expect(await cloneCheck({ io, flags: { offline: false, repo: 'a/b' } })).toMatchObject({
      status: 'warn',
      detail: 'could not search /clones for a/b: EACCES',
    })
  })
})

import { describe, expect, it } from 'vitest'

import { AppAuthError } from '../gh-cli/app-auth.mts'
import type { AppConfig } from '../gh-cli/index.mts'
import { fakeIo, notFound } from './doctor-fake-io.mts'
import { PROBE_TIMEOUT_MS } from './probe.mts'
import { authChecks, binaryCheck, nodeCheck } from './system-checks.mts'

const flags = { offline: false }

describe('node', () => {
  const at = (nodeVersion: string, nodeRange = '>=24') =>
    nodeCheck({ io: { ...fakeIo().io, nodeVersion, nodeRange }, flags })

  it('is ok at or above the minimum', () => {
    expect(at('24.0.0').status).toBe('ok')
    expect(at('26.2.1').status).toBe('ok')
    expect(at('24.3.0', '>=24.3').status).toBe('ok')
  })

  it('fails below the minimum with the fix', () => {
    expect(at('22.11.0')).toMatchObject({ status: 'fail', fix: expect.stringContaining('Node 24') })
    expect(at('24.2.0', '>=24.3').status).toBe('fail')
  })

  it('warns when the range is not one it can read', () => {
    expect(at('24.0.0', '^24').status).toBe('warn')
  })
})

describe('git and gh', () => {
  it('is ok with the version line', async () => {
    const { io } = fakeIo({ exec: { 'git --version': 'git version 2.50.0\n' } })
    expect(await binaryCheck(io, 'git')).toEqual({
      name: 'git',
      status: 'ok',
      detail: 'git version 2.50.0',
    })
  })

  it('fails when the binary is not on PATH, and asks with a timeout', async () => {
    const { io, exec } = fakeIo()
    const check = await binaryCheck(io, 'gh')
    expect(check).toMatchObject({ status: 'fail', detail: 'gh is not on PATH' })
    expect(check.fix).toContain('https://cli.github.com')
    expect(exec).toHaveBeenCalledWith('gh', ['--version'], { timeoutMs: PROBE_TIMEOUT_MS })
  })

  it('fails when the binary does not run, such as on a timeout', async () => {
    const { io } = fakeIo({ exec: { 'git --version': new Error('timed out') } })
    expect(await binaryCheck(io, 'git')).toMatchObject({
      status: 'fail',
      detail: 'git did not run',
    })
    expect(notFound('x').code).toBe('ENOENT')
  })
})

describe('github app and gh login', () => {
  const app = { appId: '1', privateKey: 'KEY-MATERIAL', source: '/cfg/app.yaml' } as AppConfig

  it('treats an absent App as ok and checks the gh login', async () => {
    const { io, exec } = fakeIo({ exec: { 'gh auth status': 'Logged in as TOKEN-ghp_secret' } })
    const checks = await authChecks({ io, flags })
    expect(checks).toEqual([
      { name: 'github-app', status: 'ok', detail: 'no App configured; the local gh login is used' },
      { name: 'gh-login', status: 'ok', detail: 'gh is logged in' },
    ])
    expect(exec).toHaveBeenCalledWith('gh', ['auth', 'status'], { timeoutMs: PROBE_TIMEOUT_MS })
  })

  it('fails the login with the fix when gh is logged out, without printing its output', async () => {
    const { io } = fakeIo({ exec: { 'gh auth status': new Error('token ghp_secret invalid') } })
    const [, login] = await authChecks({ io, flags })
    expect(login).toEqual({
      name: 'gh-login',
      status: 'fail',
      detail: 'gh is not logged in, or could not be asked',
      fix: 'gh auth login',
    })
    expect(JSON.stringify(login)).not.toContain('ghp_secret')
  })

  it('reports a parsed App without its key and skips the gh login', async () => {
    const { io, exec } = fakeIo({ io: { loadApp: () => app } })
    const checks = await authChecks({ io, flags })
    expect(checks).toEqual([
      { name: 'github-app', status: 'ok', detail: 'App config parses (source /cfg/app.yaml)' },
      { name: 'gh-login', status: 'ok', detail: 'not needed; calls use the GitHub App' },
    ])
    expect(JSON.stringify(checks)).not.toContain('KEY-MATERIAL')
    expect(exec).not.toHaveBeenCalled()
  })

  it('fails an App config that does not parse, and still checks the gh login', async () => {
    const { io } = fakeIo({
      io: {
        loadApp: () => {
          throw new AppAuthError('GitHub App config /cfg/app.yaml: appId is missing.')
        },
      },
      exec: { 'gh auth status': '' },
    })
    const [appCheck, login] = await authChecks({ io, flags })
    expect(appCheck).toMatchObject({
      status: 'fail',
      detail: 'GitHub App config /cfg/app.yaml: appId is missing.',
    })
    expect(appCheck?.fix).toContain('remove it')
    expect(login?.status).toBe('ok')
  })
})

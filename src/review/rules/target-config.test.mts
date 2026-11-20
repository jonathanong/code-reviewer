import { describe, expect, it, vi } from 'vitest'

import { NO_CONFIGS, parseRepoConfig } from './config.mts'
import {
  apiFileReader,
  gitFileReader,
  readTargetConfig,
  withTargetConsumes,
} from './target-config.mts'

describe('apiFileReader', () => {
  it('reads the raw file from the default branch', async () => {
    const run = vi.fn(async (_args: string[]) => '{}')
    await expect(apiFileReader(run, 'acme/web')()).resolves.toBe('{}')
    expect(run).toHaveBeenCalledWith([
      'api',
      '-H',
      'Accept: application/vnd.github.raw+json',
      'repos/acme/web/contents/.code-reviewer.json',
    ])
  })

  it('treats a 404 as no file and rethrows any other failure', async () => {
    const absent = async (): Promise<string> => {
      throw new Error('gh: Not Found (HTTP 404)')
    }
    await expect(apiFileReader(absent, 'acme/web')()).resolves.toBeUndefined()
    const broken = async (): Promise<string> => {
      throw new Error('HTTP 502')
    }
    await expect(apiFileReader(broken, 'acme/web')()).rejects.toThrow('HTTP 502')
    const notError = () => Promise.reject('boom')
    await expect(apiFileReader(notError, 'acme/web')()).rejects.toBe('boom')
  })
})

describe('gitFileReader', () => {
  it('reads the remote default branch, never the working tree', async () => {
    const git = vi.fn(async (args: string[]) =>
      args.includes('--abbrev-ref') ? 'origin/main\n' : '{"labels":{}}',
    )
    const fallback = vi.fn(async () => 'api')
    await expect(gitFileReader('/t', git, fallback)()).resolves.toBe('{"labels":{}}')
    expect(git).toHaveBeenLastCalledWith(['-C', '/t', 'show', 'origin/main:.code-reviewer.json'])
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back when the clone has no remote default branch, since HEAD may be the pull request', async () => {
    const git = vi.fn(async (_args: string[]): Promise<string> => {
      throw new Error('no origin')
    })
    const fallback = vi.fn(async () => 'api')
    await expect(gitFileReader('/t', git, fallback)()).resolves.toBe('api')
    expect(git.mock.calls.some(([args]) => args.includes('show'))).toBe(false)
  })
})

describe('readTargetConfig', () => {
  it('parses the file as a repository config', async () => {
    const result = await readTargetConfig(async () => '{"checkRun":{"name":"CR"},"x":1}', 'a/b')
    expect(result.config?.checkRun).toEqual({ name: 'CR' })
    expect(result.problems).toEqual(['a/b/.code-reviewer.json: unknown key "x" ignored'])
  })

  it('has no config and no problem when the file is absent', async () => {
    await expect(readTargetConfig(async () => undefined, 'a/b')).resolves.toEqual({
      config: undefined,
      problems: [],
    })
  })

  it('turns a failed read into a problem', async () => {
    const result = await readTargetConfig(async () => {
      throw new Error('HTTP 500\nbody')
    }, 'a/b')
    expect(result).toEqual({
      config: undefined,
      problems: ['a/b/.code-reviewer.json: could not be read (HTTP 500); ignored'],
    })
    const odd = await readTargetConfig(() => Promise.reject('x'), 'a/b')
    expect(odd.problems).toEqual(['a/b/.code-reviewer.json: could not be read (x); ignored'])
  })
})

describe('withTargetConsumes', () => {
  const target = parseRepoConfig('{"consumes":[{"repo":"a/lib"}]}', 'f')
  const machine = (consumes: unknown[]) => ({
    ...NO_CONFIGS,
    byRepo: new Map([['a/b', parseRepoConfig(JSON.stringify({ consumes }), 'a/b.json')]]),
  })

  it('leaves the configs alone without a repository file', () => {
    expect(withTargetConsumes(NO_CONFIGS, 'a/b', undefined)).toBe(NO_CONFIGS)
  })

  it('adds the repository file when the machine config has no consumes', () => {
    const added = withTargetConsumes(machine([]), 'A/B', target)
    expect(added.byRepo.get('a/b')?.consumes.map((c) => c.repo)).toEqual(['a/lib'])
    expect(withTargetConsumes(NO_CONFIGS, 'a/b', target).byRepo.get('a/b')?.consumes).toHaveLength(
      1,
    )
  })

  it('keeps the machine consumes when it sets any', () => {
    const configs = machine([{ repo: 'a/other' }])
    expect(withTargetConsumes(configs, 'a/b', target)).toBe(configs)
  })
})

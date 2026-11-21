import { describe, expect, it, vi } from 'vitest'

import { NO_CONFIGS, parseRepoConfig } from './config.mts'
import {
  apiFileReader,
  gitFileReader,
  readTargetConfig,
  withTargetConsumes,
} from './target-config.mts'

const FILE = '.code-reviewer.json'
const one = (name: string, text: string) => async () => [{ name, text }]
const isListing = (args: string[]) => args.at(-1)?.endsWith('/contents') === true

describe('apiFileReader', () => {
  it('lists the repository root once, then reads only the config file it holds', async () => {
    const run = vi.fn(async (args: string[]) =>
      isListing(args) ? 'README.md\n.code-reviewer.jsonc\n' : '{}',
    )
    await expect(apiFileReader(run, 'acme/web')()).resolves.toEqual([
      { name: '.code-reviewer.jsonc', text: '{}' },
    ])
    expect(run.mock.calls.map(([args]) => args.at(-1))).toEqual([
      'repos/acme/web/contents',
      'repos/acme/web/contents/.code-reviewer.jsonc',
    ])
    expect(run.mock.calls[1]?.[0]).toContain('Accept: application/vnd.github.raw+json')
  })

  it('costs one request when no config file is at the root', async () => {
    const run = vi.fn(async (_args: string[]) => 'README.md\nsrc\n')
    await expect(apiFileReader(run, 'acme/web')()).resolves.toEqual([])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('returns every config file present, so a duplicate can be reported', async () => {
    const run = vi.fn(async (args: string[]) =>
      isListing(args) ? '.code-reviewer.jsonc\n.code-reviewer.json\n' : '{}',
    )
    const files = await apiFileReader(run, 'acme/web')()
    expect(files.map((file) => file.name)).toEqual(['.code-reviewer.json', '.code-reviewer.jsonc'])
  })

  it('treats a 404 as no file and rethrows any other failure', async () => {
    const absent = async (): Promise<string> => {
      throw new Error('gh: Not Found (HTTP 404)')
    }
    await expect(apiFileReader(absent, 'acme/web')()).resolves.toEqual([])
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
    const git = vi.fn(async (args: string[]) => {
      if (args.includes('--abbrev-ref')) return 'origin/main\n'
      if (args.at(-1) === 'origin/main:.code-reviewer.jsonc') return '{"labels":{}}'
      throw new Error('not in the tree')
    })
    const fallback = vi.fn(async () => [])
    await expect(gitFileReader('/t', git, fallback)()).resolves.toEqual([
      { name: '.code-reviewer.jsonc', text: '{"labels":{}}' },
    ])
    expect(git).toHaveBeenCalledWith(['-C', '/t', 'show', 'origin/main:.code-reviewer.json'])
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back when the clone has no remote default branch, since HEAD may be the pull request', async () => {
    const git = vi.fn(async (_args: string[]): Promise<string> => {
      throw new Error('no origin')
    })
    const fallback = vi.fn(async () => [{ name: FILE, text: 'api' }])
    await expect(gitFileReader('/t', git, fallback)()).resolves.toEqual([
      { name: FILE, text: 'api' },
    ])
    expect(git.mock.calls.some(([args]) => args.includes('show'))).toBe(false)
  })
})

describe('readTargetConfig', () => {
  it('parses the file as a repository config, naming the file it found', async () => {
    const result = await readTargetConfig(
      one('.code-reviewer.jsonc', '{"checkRun":{"name":"CR"},"x":1, // note\n}'),
      'a/b',
    )
    expect(result.config?.checkRun).toEqual({ name: 'CR' })
    expect(result.problems).toEqual(['a/b/.code-reviewer.jsonc: unknown key "x" ignored'])
  })

  it('never takes evidence sources from the repository file', async () => {
    const text = JSON.stringify({
      evidence: [
        {
          name: 'aws',
          description: 'Logs.',
          guide: { file: '/g.md' },
          commands: ['aws logs filter-log-events'],
        },
      ],
    })
    const result = await readTargetConfig(one(FILE, text), 'a/b')
    expect(result.config?.evidence).toBeUndefined()
    expect(result.problems).toEqual([
      'a/b/.code-reviewer.json: evidence sources are machine-only; ignored',
    ])
  })

  it('has no config and no problem when the file is absent', async () => {
    await expect(readTargetConfig(async () => [], 'a/b')).resolves.toEqual({
      config: undefined,
      problems: [],
    })
  })

  it('uses neither file when the repository keeps both formats, and names both', async () => {
    const result = await readTargetConfig(
      async () => [
        { name: '.code-reviewer.json', text: '{"checkRun":{"name":"A"}}' },
        { name: '.code-reviewer.jsonc', text: '{"checkRun":{"name":"B"}}' },
      ],
      'a/b',
    )
    expect(result.config).toBeUndefined()
    expect(result.problems).toEqual([
      'a/b/.code-reviewer.json and a/b/.code-reviewer.jsonc: more than one file for the same config; none is used',
    ])
  })

  it('reports a file that does not parse, naming it', async () => {
    const result = await readTargetConfig(one('.code-reviewer.jsonc', '{'), 'a/b')
    expect(result.problems).toEqual(['a/b/.code-reviewer.jsonc: not valid JSON; ignored'])
  })

  it('turns a failed read into a problem', async () => {
    const result = await readTargetConfig(async () => {
      throw new Error('HTTP 500\nbody')
    }, 'a/b')
    expect(result).toEqual({
      config: undefined,
      problems: [
        'a/b/.code-reviewer{.json,.jsonc,.yaml,.yml}: could not be read (HTTP 500); ignored',
      ],
    })
    const odd = await readTargetConfig(() => Promise.reject('x'), 'a/b')
    expect(odd.problems).toEqual([
      'a/b/.code-reviewer{.json,.jsonc,.yaml,.yml}: could not be read (x); ignored',
    ])
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

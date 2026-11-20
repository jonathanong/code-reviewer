import { describe, expect, it } from 'vitest'

import { resolveRun } from '../settings.mts'
import { parseRepoConfig, type RepoConfigs } from './config.mts'
import { DEFAULT_RUN, parseRun } from './run-parse.mts'

function parsed(raw: unknown) {
  const problems: string[] = []
  return { run: parseRun(raw, 'acme.json run', problems), problems }
}

describe('parseRun', () => {
  it('reads rule switches and large-change limits', () => {
    expect(
      parsed({ rules: { 'risky-change': false }, largeChange: { files: 5, lines: 20 } }),
    ).toEqual({
      run: { rules: { 'risky-change': false }, largeChange: { files: 5, lines: 20 } },
      problems: [],
    })
  })

  it('reads riskyPaths, an empty list included, and leaves it out when absent', () => {
    expect(parsed({ riskyPaths: ['**/*.tf'] }).run?.riskyPaths).toEqual(['**/*.tf'])
    expect(parsed({ riskyPaths: [] }).run?.riskyPaths).toEqual([])
    expect(parsed({}).run).not.toHaveProperty('riskyPaths')
  })

  it('reports riskyPaths that is not a list or has a bad entry, keeping the good ones', () => {
    expect(parsed({ riskyPaths: 'a' }).problems).toEqual([
      'acme.json run riskyPaths: must be a list of glob patterns',
    ])
    const { run, problems } = parsed({ riskyPaths: ['a', '', ' ', 3] })
    expect(run?.riskyPaths).toEqual(['a'])
    expect(problems).toEqual([
      'acme.json run riskyPaths: entry 1 must be a non-empty string',
      'acme.json run riskyPaths: entry 2 must be a non-empty string',
      'acme.json run riskyPaths: entry 3 must be a non-empty string',
    ])
  })

  it('has no run for an absent key', () => {
    expect(parsed(undefined)).toEqual({ run: undefined, problems: [] })
  })

  it('reports an unknown rule name, a non-boolean switch and an unknown key', () => {
    const { problems } = parsed({ rules: { 'no-such-rule': true, 'large-change': 'no' }, extra: 1 })
    expect(problems).toEqual([
      'acme.json run: unknown key "extra" ignored',
      'acme.json run rules: unknown key "no-such-rule" ignored',
      'acme.json run rules: "large-change" must be true or false',
    ])
  })

  it('reports a limit that is not a positive integer and an unknown limit', () => {
    const { problems } = parsed({ largeChange: { files: 0, lines: 1.5, bytes: 1 } })
    expect(problems).toEqual([
      'acme.json run largeChange: unknown key "bytes" ignored',
      'acme.json run largeChange: "files" must be a positive integer',
      'acme.json run largeChange: "lines" must be a positive integer',
    ])
  })

  it('reports a section or key of the wrong type', () => {
    expect(parsed('x').problems).toEqual(['acme.json run: must be an object'])
    expect(parsed({ rules: [], largeChange: 3 }).problems).toEqual([
      'acme.json run rules: must be an object',
      'acme.json run largeChange: must be an object',
    ])
  })
})

describe('run in a config file', () => {
  it('is read from machine files and ignored from the repository file', () => {
    const text = JSON.stringify({ run: { rules: { 'large-change': false } } })
    expect(parseRepoConfig(text, 'acme/a.json').run).toEqual({
      rules: { 'large-change': false },
      largeChange: {},
    })
    expect(parseRepoConfig(text, 'acme.json', 'owner').run?.rules).toEqual({
      'large-change': false,
    })
    const target = parseRepoConfig(text, '.code-reviewer.json', 'target')
    expect(target.run).toBeUndefined()
    expect(target.problems).toEqual(['.code-reviewer.json: run settings are machine-only; ignored'])
  })
})

describe('resolveRun', () => {
  const configs: RepoConfigs = {
    byOwner: new Map([
      ['acme', parseRepoConfig('{"run":{"largeChange":{"files":10}}}', 'acme.json', 'owner')],
    ]),
    byRepo: new Map([
      ['acme/a', parseRepoConfig('{"run":{"rules":{"not-app-identity":false}}}', 'acme/a.json')],
    ]),
    problems: [],
  }

  it('resolves riskyPaths from the highest layer, and an empty list stays empty', () => {
    const risky = (json: string) => ({
      ...configs,
      byRepo: new Map([['acme/a', parseRepoConfig(json, 'acme/a.json')]]),
    })
    expect(resolveRun(risky('{"run":{"riskyPaths":[]}}'), 'acme/a').riskyPaths).toEqual([])
    expect(resolveRun(risky('{"run":{"riskyPaths":["*.tf"]}}'), 'acme/a').riskyPaths).toEqual([
      '*.tf',
    ])
    expect(resolveRun(configs, 'acme/a').riskyPaths).toBeUndefined()
  })

  it('uses the defaults when no machine file sets run', () => {
    expect(resolveRun({ ...configs, byOwner: new Map(), byRepo: new Map() }, 'acme/b')).toEqual(
      DEFAULT_RUN,
    )
  })

  it('lets the repository file win over the owner file, for the whole key', () => {
    const run = resolveRun(configs, 'acme/a')
    expect(run.rules['not-app-identity']).toBe(false)
    expect(run.largeChange).toEqual(DEFAULT_RUN.largeChange)
  })

  it('uses the owner file for a repository without its own', () => {
    expect(resolveRun(configs, 'acme/b').largeChange).toEqual({ files: 10, lines: 1000 })
  })
})

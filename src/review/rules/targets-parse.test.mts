import { describe, expect, it } from 'vitest'

import { parseRepoConfig } from './config.mts'
import { parseTargets } from './targets-parse.mts'

const KNOWN = ['alpha', 'beta']

describe('parseTargets', () => {
  it('accepts absent, empty, disabled list, or disabled: all', () => {
    const problems: string[] = []
    expect(parseTargets(undefined, 'f targets', problems, KNOWN)).toBeUndefined()
    expect(parseTargets({}, 'f targets', problems, KNOWN)).toEqual({})
    expect(parseTargets({ disabled: [] }, 'f targets', problems, KNOWN)).toEqual({ disabled: [] })
    expect(parseTargets({ disabled: ['alpha'] }, 'f targets', problems, KNOWN)).toEqual({
      disabled: ['alpha'],
    })
    expect(parseTargets({ disabled: 'all' }, 'f targets', problems, KNOWN)).toEqual({
      disabled: 'all',
    })
    expect(problems).toEqual([])
  })

  it('rejects non-object, unknown keys, bad disabled values, unknown targets, and repeats', () => {
    const run = (raw: unknown, known: readonly string[] = KNOWN) => {
      const problems: string[] = []
      const parsed = parseTargets(raw, 'acme.yaml targets', problems, known)
      return { parsed, problems }
    }
    expect(run('all')).toEqual({
      parsed: undefined,
      problems: ['acme.yaml targets: must be an object; ignored'],
    })
    expect(run({ extra: true }).problems[0]).toContain('unknown key "extra"')
    expect(run({ disabled: 7 }).problems[0]).toContain('must be "all" or an array')
    expect(run({ disabled: ['nope'] }).problems[0]).toContain(
      'acme.yaml targets.disabled: unknown target "nope"; use alpha, beta, or "all"',
    )
    expect(run({ disabled: ['nope'] }, []).problems[0]).toContain('use "all"')
    expect(run({ disabled: ['alpha', 'alpha'] }).problems[0]).toContain('listed more than once')
  })

  it('integrates with parseRepoConfig for both machine and repository files', () => {
    const ok = parseRepoConfig(
      'targets:\n  disabled: [unneeded-concurrency-guard]\n',
      '.code-reviewer.yaml',
      'target',
    )
    expect(ok.problems).toEqual([])
    expect(ok.targets).toEqual({ disabled: ['unneeded-concurrency-guard'] })

    const bad = parseRepoConfig(
      'targets:\n  disabled: [unknown-target]\n',
      '.code-reviewer.yaml',
      'target',
    )
    expect(bad.targets).toBeUndefined()
    expect(bad.problems[0]).toContain('.code-reviewer.yaml targets.disabled: unknown target')
  })
})

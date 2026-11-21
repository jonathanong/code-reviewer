import { describe, expect, it } from 'vitest'

import { parseRepoConfig, type ConfigScope } from './config.mts'
import { parsePlan, type PlanFileScope } from './plan-parse.mts'

function parse(scope: PlanFileScope, raw: unknown) {
  const problems: string[] = []
  return { value: parsePlan(scope, raw, 'f plan', problems), problems }
}

const FULL = {
  securityPaths: ['infra/**', ' deploy/*.yml '],
  generatedPaths: ['**/*.pb.ts'],
  authors: [{ login: 'renovate[bot]', review: 'skip' }],
  smallChangeLines: 40,
}

describe('parsePlan', () => {
  it('is absent when the key is absent', () => {
    expect(parse('repo', undefined)).toEqual({ value: undefined, problems: [] })
  })

  it.each<PlanFileScope>(['repo', 'owner'])('reads every part in a %s machine file', (scope) => {
    expect(parse(scope, FULL)).toEqual({
      value: { ...FULL, securityPaths: ['infra/**', 'deploy/*.yml'] },
      problems: [],
    })
  })

  it('lets a trusted repository file set paths and the threshold, but not authors', () => {
    const { value, problems } = parse('trusted', FULL)
    expect(value).toEqual({
      securityPaths: ['infra/**', 'deploy/*.yml'],
      generatedPaths: ['**/*.pb.ts'],
      smallChangeLines: 40,
    })
    expect(problems).toEqual(['f plan.authors: machine-only; ignored'])
  })

  it('lets an untrusted repository file add only security paths', () => {
    const { value, problems } = parse('target', FULL)
    expect(value).toEqual({ securityPaths: ['infra/**', 'deploy/*.yml'] })
    expect(problems).toEqual([
      'f plan.generatedPaths: machine-only unless trustRepoConfig is on; ignored',
      'f plan.authors: machine-only; ignored',
      'f plan.smallChangeLines: machine-only unless trustRepoConfig is on; ignored',
    ])
  })

  it('accepts a threshold of zero', () => {
    expect(parse('repo', { smallChangeLines: 0 }).value).toEqual({ smallChangeLines: 0 })
  })

  it.each([
    ['plan is not an object', ['x'], 'f plan: must be an object; ignored'],
    ['a list is not a list', { securityPaths: 'infra/**' }, 'f plan.securityPaths: must be a list'],
    ['an entry is blank', { generatedPaths: ['a', ' '] }, 'f plan.generatedPaths: entry 1'],
    [
      'an entry is not text',
      { authors: ['renovate'] },
      'f plan.authors[0]: must be { login, review }',
    ],
    ['the threshold is fractional', { smallChangeLines: 1.5 }, 'f plan.smallChangeLines: must be'],
    ['the threshold is negative', { smallChangeLines: -1 }, 'f plan.smallChangeLines: must be'],
    ['the threshold is text', { smallChangeLines: '40' }, 'f plan.smallChangeLines: must be'],
    ['a key is unknown', { skipAuthor: [] }, 'f plan: unknown key "skipAuthor" ignored'],
  ])('reports a problem naming the key when %s', (_name, raw, problem) => {
    const { value, problems } = parse('repo', raw)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(problem)
    expect(value?.securityPaths ?? value?.generatedPaths ?? value?.authors).toBeUndefined()
    expect(value?.smallChangeLines).toBeUndefined()
  })
})

describe('parsePlan authors', () => {
  it('reads rules, trimming the login', () => {
    const raw = {
      authors: [
        { login: ' renovate[bot] ', review: 'light' },
        { login: 'a', review: 'skip' },
      ],
    }
    expect(parse('repo', raw)).toEqual({
      value: {
        authors: [
          { login: 'renovate[bot]', review: 'light' },
          { login: 'a', review: 'skip' },
        ],
      },
      problems: [],
    })
  })

  it.each([
    ['is not a list', { login: 'a', review: 'skip' }, 'f plan.authors: must be a list'],
    ['is not an object', ['a'], 'f plan.authors[0]: must be { login, review }'],
    ['has no login', [{ review: 'skip' }], 'f plan.authors[0]: must be { login, review }'],
    ['has a blank login', [{ login: ' ', review: 'skip' }], 'f plan.authors[0]: must be'],
    ['has an unknown review', [{ login: 'a', review: 'full' }], 'f plan.authors[0]: must be'],
    ['has no review', [{ login: 'a' }], 'f plan.authors[0]: must be'],
  ])('reports a problem and ignores the list when an entry %s', (_name, authors, problem) => {
    const { value, problems } = parse('repo', { authors })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(problem)
    expect(value?.authors).toBeUndefined()
  })

  it('reports an unknown key of a rule but keeps the rule', () => {
    const { value, problems } = parse('repo', { authors: [{ login: 'a', review: 'skip', x: 1 }] })
    expect(problems).toEqual(['f plan.authors[0]: unknown key "x" ignored'])
    expect(value?.authors).toEqual([{ login: 'a', review: 'skip' }])
  })

  it('names the new key when the removed skipAuthors is still set', () => {
    const { value, problems } = parse('repo', { skipAuthors: ['renovate'] })
    expect(problems).toEqual([
      'f plan.skipAuthors: no longer a setting; use f plan.authors: [{ login, review: "light" }]; ignored',
    ])
    expect(value?.authors).toBeUndefined()
  })
})

describe('parseRepoConfig plan', () => {
  const text = JSON.stringify({ plan: FULL })
  const parseAs = (scope: ConfigScope) => parseRepoConfig(text, 'acme/web.json', scope)

  it('parses the key in a machine file and names the file in a problem', () => {
    expect(parseAs('repo').plan?.authors).toEqual([{ login: 'renovate[bot]', review: 'skip' }])
    const bad = parseRepoConfig('{"plan":{"smallChangeLines":-2}}', 'acme.json', 'owner')
    expect(bad.problems).toEqual([
      'acme.json plan.smallChangeLines: must be a non-negative integer; ignored',
    ])
  })

  it('applies the repository-file split by scope', () => {
    expect(parseAs('target').plan).toEqual({ securityPaths: ['infra/**', 'deploy/*.yml'] })
    expect(parseAs('trusted').plan?.generatedPaths).toEqual(['**/*.pb.ts'])
    expect(parseAs('trusted').plan?.authors).toBeUndefined()
  })
})

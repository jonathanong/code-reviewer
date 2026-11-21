import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadRepoConfigs, parseRepoConfig } from './config.mts'

/** The problems of the same settings written as YAML and as JSON, with the file name made equal. */
function problemsBoth(yaml: string, json: string): { yaml: string[]; json: string[] } {
  return {
    yaml: parseRepoConfig(yaml, 'f.yaml').problems.map((p) => p.replace('f.yaml', 'f')),
    json: parseRepoConfig(json, 'f.json').problems.map((p) => p.replace('f.json', 'f')),
  }
}

describe('parseRepoConfig with YAML', () => {
  it('reads the same settings as the JSON equivalent', () => {
    const yaml =
      'consumes:\n  - repo: acme/api\n    paths: [src/**]\n    via: HTTP API\nlabels:\n  requested: go\n'
    const json =
      '{"consumes":[{"repo":"acme/api","paths":["src/**"],"via":"HTTP API"}],"labels":{"requested":"go"}}'
    const parsed = parseRepoConfig(yaml, 'acme/web.yml')
    expect(parsed).toEqual(parseRepoConfig(json, 'acme/web.json'))
    expect(parsed.consumes).toHaveLength(1)
  })

  it('names the file and the line of a YAML syntax error', () => {
    const [problem] = parseRepoConfig('labels: {}\nlabels: {}\n', 'a/b.yaml').problems
    expect(problem).toMatch(/^a\/b\.yaml: not valid YAML \(.* at line 2\); ignored$/u)
  })

  it('rejects a tag or an alias as a problem naming the file and line', () => {
    expect(parseRepoConfig('labels: !x {}\n', 'a.yaml').problems[0]).toMatch(
      /^a\.yaml: not valid YAML \(.* at line 1\); ignored$/u,
    )
    expect(parseRepoConfig('a: &x 1\nb: *x\n', 'a.yaml').problems).toEqual([
      'a.yaml: not valid YAML (ALIAS at line 2); ignored',
    ])
  })

  it('rejects a top level that is not a mapping, as a JSON one that is not an object is', () => {
    for (const text of ['- a\n- b\n', 'just text\n', '42\n']) {
      expect(parseRepoConfig(text, 'a.yaml')).toEqual({
        consumes: [],
        problems: ['a.yaml: must be a YAML mapping; ignored'],
      })
    }
    expect(parseRepoConfig('[]', 'a.json').problems).toEqual([
      'a.json: must be a JSON object; ignored',
    ])
  })

  it('rejects an empty file as an empty JSON file is, while an empty mapping is valid', () => {
    expect(parseRepoConfig('', 'a.json').problems).toEqual(['a.json: not valid JSON; ignored'])
    expect(parseRepoConfig('', 'a.yaml').problems).toEqual([
      'a.yaml: must be a YAML mapping; ignored',
    ])
    expect(parseRepoConfig('# nothing yet\n', 'a.yml').problems).toEqual([
      'a.yml: must be a YAML mapping; ignored',
    ])
    expect(parseRepoConfig('{}', 'a.json').problems).toEqual([])
    expect(parseRepoConfig('{}', 'a.yaml').problems).toEqual([])
  })

  it('reports a number where a string belongs as the JSON equivalent does', () => {
    const cases: [string, string][] = [
      ['labels:\n  requested: 123\n', '{"labels":{"requested":123}}'],
      ['consumes:\n  - repo: 123\n', '{"consumes":[{"repo":123}]}'],
      [
        'consumes:\n  - repo: acme/api\n    via: 2024\n',
        '{"consumes":[{"repo":"acme/api","via":2024}]}',
      ],
    ]
    for (const [yaml, json] of cases) {
      const both = problemsBoth(yaml, json)
      expect(both.yaml.length).toBeGreaterThan(0)
      expect(both.yaml).toEqual(both.json)
    }
  })

  it('reports unquoted yes and no as the strings they are, so a switch rejects them', () => {
    for (const word of ['yes', 'no', 'on', 'off']) {
      const both = problemsBoth(`approvalCheck: ${word}\n`, `{"approvalCheck":"${word}"}`)
      expect(both.yaml).toHaveLength(1)
      expect(both.yaml).toEqual(both.json)
    }
    expect(parseRepoConfig('approvalCheck: false\n', 'a.yaml').approvalCheck).toBe(false)
  })

  it('keeps an unquoted date and a number-like repository name as strings', () => {
    const parsed = parseRepoConfig('consumes:\n  - repo: acme/123\n    via: 2024-01-01\n', 'a.yaml')
    expect(parsed.problems).toEqual([])
    expect(parsed.consumes).toEqual([{ repo: 'acme/123', paths: [], via: '2024-01-01' }])
  })

  it('reports an unknown key and a repository-only key as for JSON', () => {
    const both = problemsBoth('consume: []\nevidence: []\n', '{"consume":[],"evidence":[]}')
    expect(both.yaml).toHaveLength(1)
    expect(both.yaml).toEqual(both.json)
  })
})

describe('loadRepoConfigs with YAML files', () => {
  const configs = loadRepoConfigs(join(import.meta.dirname, 'fixtures/yaml'))

  it('reads .yaml and .yml files with comments, under the file stem as key', () => {
    expect(configs.byOwner.get('acme')?.labels).toEqual({ requested: 'go' })
    expect(configs.byRepo.get('acme/web')?.consumes).toEqual([
      { repo: 'acme/api', paths: [], via: 'http://api.example//v1' },
    ])
  })

  it('uses neither file of a config kept in two formats, whichever two they are', () => {
    expect(configs.byOwner.has('beta')).toBe(false)
    expect(configs.byRepo.has('acme/dup')).toBe(false)
    expect(configs.problems).toContain(
      'beta.json and beta.yaml: more than one file for the same config; none is used',
    )
    expect(configs.problems).toContain(
      'acme/dup.yaml and acme/dup.yml: more than one file for the same config; none is used',
    )
  })

  it('reports a file that does not parse, naming it and the line, and keeps the others', () => {
    expect(configs.problems.filter((problem) => problem.startsWith('broken.yaml'))).toHaveLength(1)
    expect(configs.problems.join('\n')).toMatch(/broken\.yaml: not valid YAML \(.* at line 2\)/u)
    expect(configs.byOwner.get('acme')).toBeDefined()
  })
})

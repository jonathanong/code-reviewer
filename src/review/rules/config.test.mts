import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { configHome, loadRepoConfigs, machineConfigDir, parseRepoConfig } from './config.mts'

const FILE = 'acme/web.json'

describe('parseRepoConfig', () => {
  it('reads consumed repositories with optional paths and via', () => {
    expect(parseRepoConfig('{}', FILE)).toEqual({ consumes: [], problems: [] })
    const text = JSON.stringify({
      consumes: [
        { repo: 'Acme/API', paths: ['src/routes/**'], via: ' HTTP\n API ' },
        { repo: 'acme/schema' },
      ],
    })
    expect(parseRepoConfig(text, FILE)).toEqual({
      consumes: [
        { repo: 'acme/api', paths: ['src/routes/**'], via: 'HTTP API' },
        { repo: 'acme/schema', paths: [], via: '' },
      ],
      problems: [],
    })
  })

  it('reports invalid JSON and non-object files', () => {
    expect(parseRepoConfig('{', FILE).problems).toEqual([`${FILE}: not valid JSON; ignored`])
    expect(parseRepoConfig('[]', FILE).problems).toEqual([
      `${FILE}: must be a JSON object; ignored`,
    ])
  })

  it('reports unknown keys and a non-array consumes', () => {
    expect(parseRepoConfig('{"consume": [], "consumes": {}}', FILE)).toEqual({
      consumes: [],
      problems: [`${FILE}: unknown key "consume" ignored`, `${FILE}: "consumes" must be an array`],
    })
  })

  it('drops bad entries and keeps the good ones', () => {
    const text = JSON.stringify({
      consumes: [
        'acme/api',
        { repo: '../etc' },
        { repo: 'acme/a', paths: 'src/**' },
        { repo: 'acme/b', paths: [''] },
        { repo: 'acme/c', via: 3, extra: true },
      ],
    })
    const where = `${FILE} consumes`
    expect(parseRepoConfig(text, FILE)).toEqual({
      consumes: [{ repo: 'acme/c', paths: [], via: '' }],
      problems: [
        `${where}[0]: needs "repo" as owner/name; entry ignored`,
        `${where}[1]: needs "repo" as owner/name; entry ignored`,
        `${where}[2]: "paths" must be an array of globs; entry ignored`,
        `${where}[3]: "paths" must be an array of globs; entry ignored`,
        `${where}[4]: unknown key "extra" ignored`,
        `${where}[4]: "via" must be a string; ignored`,
      ],
    })
  })
})

describe('parseRepoConfig settings', () => {
  it('reads labels and a check run alongside consumes', () => {
    const text = JSON.stringify({
      labels: { requested: 'go' },
      checkRun: { name: 'Code review' },
      consumes: [{ repo: 'acme/api' }],
    })
    expect(parseRepoConfig(text, FILE)).toEqual({
      consumes: [{ repo: 'acme/api', paths: [], via: '' }],
      labels: { requested: 'go' },
      checkRun: { name: 'Code review' },
      problems: [],
    })
  })

  it('reports settings problems and keeps going past a bad consumes', () => {
    const text = JSON.stringify({ consumes: 3, labels: [], checkRun: { name: '' } })
    expect(parseRepoConfig(text, FILE)).toEqual({
      consumes: [],
      problems: [
        `${FILE} labels: must be an object; ignored`,
        `${FILE} checkRun: "name" must be a non-empty string without quotes or control characters; ignored`,
        `${FILE}: "consumes" must be an array`,
      ],
    })
  })

  it('ignores consumes in an owner file and says so', () => {
    const text = JSON.stringify({ consumes: [{ repo: 'acme/api' }], labels: { approval: 'ok' } })
    expect(parseRepoConfig(text, 'acme.json', 'owner')).toEqual({
      consumes: [],
      labels: { approval: 'ok' },
      problems: ['acme.json: "consumes" is repo-level only; ignored'],
    })
  })
})

describe('parseRepoConfig evidence', () => {
  const evidence = [
    {
      name: 'aws',
      description: 'Logs.',
      guide: { file: '/guides/aws.md' },
      commands: ['aws logs filter-log-events'],
      env: { AWS_PROFILE: 'readonly' },
    },
  ]

  it('reads evidence sources from a repository file and an owner file', () => {
    const text = JSON.stringify({ evidence })
    expect(parseRepoConfig(text, FILE).evidence).toEqual(evidence)
    expect(parseRepoConfig(text, 'acme.json', 'owner')).toEqual({
      consumes: [],
      evidence,
      problems: [],
    })
  })

  it('names the file in an evidence problem', () => {
    const text = JSON.stringify({ evidence: [{ ...evidence[0], commands: ['aws'] }] })
    expect(parseRepoConfig(text, FILE).problems).toEqual([
      expect.stringContaining(`${FILE} evidence[0]: every command must be`),
    ])
  })

  it('ignores evidence in the reviewed repository own file and says it is machine-only', () => {
    const parsed = parseRepoConfig(
      JSON.stringify({ evidence }),
      'acme/web/.code-reviewer.json',
      'target',
    )
    expect(parsed).toEqual({
      consumes: [],
      problems: ['acme/web/.code-reviewer.json: evidence sources are machine-only; ignored'],
    })
  })

  it('keeps the other keys of a reviewed repository file that also sets evidence', () => {
    const text = JSON.stringify({ evidence, consumes: [{ repo: 'acme/api' }] })
    const parsed = parseRepoConfig(text, 'f', 'target')
    expect(parsed.consumes).toEqual([{ repo: 'acme/api', paths: [], via: '' }])
    expect(parsed.evidence).toBeUndefined()
  })
})

describe('parseRepoConfig references', () => {
  const references = [{ name: 'aws', description: 'AWS docs.', domains: ['docs.aws.amazon.com'] }]

  it('reads references from a repository file and an owner file', () => {
    const text = JSON.stringify({ references })
    expect(parseRepoConfig(text, FILE).references).toEqual(references)
    expect(parseRepoConfig(text, 'acme.json', 'owner').references).toEqual(references)
  })

  it('names the file in a references problem', () => {
    const text = JSON.stringify({ references: [{ ...references[0], domains: ['https://x.com'] }] })
    expect(parseRepoConfig(text, FILE).problems).toEqual([
      expect.stringContaining(`${FILE} references[0]: every domain must be`),
    ])
  })

  it('ignores references in the reviewed repository own file and says they are machine-only', () => {
    const parsed = parseRepoConfig(
      JSON.stringify({ references }),
      'acme/web/.code-reviewer.json',
      'target',
    )
    expect(parsed).toEqual({
      consumes: [],
      problems: ['acme/web/.code-reviewer.json: references are machine-only; ignored'],
    })
  })
})

describe('parseRepoConfig approvalCheck', () => {
  it('reads a boolean from a repository file and an owner file', () => {
    expect(parseRepoConfig('{"approvalCheck":false}', FILE).approvalCheck).toBe(false)
    expect(parseRepoConfig('{"approvalCheck":true}', 'acme.json', 'owner').approvalCheck).toBe(true)
  })

  it('ignores anything else with a problem', () => {
    const parsed = parseRepoConfig('{"approvalCheck":"no"}', FILE)
    expect(parsed.approvalCheck).toBeUndefined()
    expect(parsed.problems).toEqual([`${FILE} approvalCheck: must be true or false; ignored`])
  })

  it('ignores it in the reviewed repository own file and says it is machine-only', () => {
    const file = 'acme/web/.code-reviewer.json'
    expect(parseRepoConfig('{"approvalCheck":false}', file, 'target')).toEqual({
      consumes: [],
      problems: [`${file}: approvalCheck is machine-only; ignored`],
    })
  })
})

describe('parseRepoConfig rulePlugins', () => {
  it('reads a list of plugin names, including an empty one', () => {
    expect(parseRepoConfig('{"rulePlugins":["a","b.c_d-e"]}', FILE).rulePlugins).toEqual([
      'a',
      'b.c_d-e',
    ])
    expect(parseRepoConfig('{"rulePlugins":[]}', 'acme.json', 'owner')).toMatchObject({
      rulePlugins: [],
      problems: [],
    })
  })

  it.each([
    ['not an array', '"a"', 'must be an array of plugin names; ignored'],
    ['a marketplace suffix', '["a@market"]', 'no "@marketplace"'],
    ['an empty name', '[""]', 'each entry must be a plugin name'],
    ['a non-string', '[1]', 'each entry must be a plugin name'],
    ['a repeated name', '["a","b","a"]', '"a" is listed more than once; ignored'],
  ])('ignores the list with a problem for %s', (_case, value, problem) => {
    const parsed = parseRepoConfig(`{"rulePlugins":${value}}`, FILE)
    expect(parsed.rulePlugins).toBeUndefined()
    expect(parsed.problems).toHaveLength(1)
    expect(parsed.problems[0]).toContain(`${FILE} rulePlugins: `)
    expect(parsed.problems[0]).toContain(problem)
  })

  it('ignores it in the reviewed repository own file and says it is machine-only', () => {
    const file = 'acme/web/.code-reviewer.json'
    expect(parseRepoConfig('{"rulePlugins":["a"]}', file, 'target')).toEqual({
      consumes: [],
      problems: [`${file}: rulePlugins is machine-only; ignored`],
    })
  })
})

describe('loadRepoConfigs', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('reads <owner>/<name>.json files keyed by lowercased owner/name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'configs-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'Acme'))
    writeFileSync(join(dir, 'Acme/Web.json'), '{"consumes":[{"repo":"acme/api"}]}')
    writeFileSync(join(dir, 'Acme/bad.json'), '{')
    writeFileSync(join(dir, 'Acme/notes.md'), 'skipped')
    writeFileSync(join(dir, 'Acme.json'), '{"labels":{"requested":"go"}}')
    writeFileSync(join(dir, 'README.md'), 'skipped')
    const configs = loadRepoConfigs(dir)
    expect([...configs.byRepo.keys()]).toEqual(['acme/web', 'acme/bad'])
    expect(configs.byRepo.get('acme/web')?.consumes).toEqual([
      { repo: 'acme/api', paths: [], via: '' },
    ])
    expect([...configs.byOwner.keys()]).toEqual(['acme'])
    expect(configs.byOwner.get('acme')?.labels).toEqual({ requested: 'go' })
    expect(configs.problems).toEqual(['Acme/bad.json: not valid JSON; ignored'])
  })

  it('holds nothing for a missing directory', () => {
    expect(loadRepoConfigs('/nowhere/configs')).toEqual({
      byRepo: new Map(),
      byOwner: new Map(),
      problems: [],
    })
  })
})

describe('configHome', () => {
  it('is code-reviewer under XDG_CONFIG_HOME or HOME/.config, and holds the repos directory', () => {
    expect(configHome({ XDG_CONFIG_HOME: '/x' })).toBe('/x/code-reviewer')
    expect(configHome({ HOME: '/h' })).toBe('/h/.config/code-reviewer')
    expect(machineConfigDir({ HOME: '/h' })).toBe('/h/.config/code-reviewer/repos')
  })
})

describe('machineConfigDir', () => {
  it('prefers CODE_REVIEWER_CONFIG_DIR, then XDG_CONFIG_HOME, then HOME/.config', () => {
    expect(machineConfigDir({ CODE_REVIEWER_CONFIG_DIR: '/c', XDG_CONFIG_HOME: '/x' })).toBe('/c')
    expect(machineConfigDir({ XDG_CONFIG_HOME: '/x', HOME: '/h' })).toBe('/x/code-reviewer/repos')
    expect(machineConfigDir({ HOME: '/h' })).toBe('/h/.config/code-reviewer/repos')
  })

  it('treats empty variables as unset and falls back to the home directory', () => {
    expect(
      machineConfigDir({ CODE_REVIEWER_CONFIG_DIR: '', XDG_CONFIG_HOME: '', HOME: '/h' }),
    ).toBe('/h/.config/code-reviewer/repos')
    expect(machineConfigDir({}).endsWith('/.config/code-reviewer/repos')).toBe(true)
  })
})

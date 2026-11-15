import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG_DIR, loadRepoConfigs, parseRepoConfig } from './config.mts'

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
    writeFileSync(join(dir, 'stray.json'), '{}')
    const configs = loadRepoConfigs(dir)
    expect([...configs.byRepo.keys()]).toEqual(['acme/web', 'acme/bad'])
    expect(configs.byRepo.get('acme/web')?.consumes).toEqual([
      { repo: 'acme/api', paths: [], via: '' },
    ])
    expect(configs.problems).toEqual(['Acme/bad.json: not valid JSON; ignored'])
  })

  it('holds nothing for a missing directory', () => {
    expect(loadRepoConfigs('/nowhere/configs')).toEqual({ byRepo: new Map(), problems: [] })
  })

  it('ships configs that parse cleanly', () => {
    const configs = loadRepoConfigs(DEFAULT_CONFIG_DIR)
    expect(configs.problems).toEqual([])
    expect(configs.byRepo.size).toBeGreaterThan(0)
  })
})

import { describe, expect, it } from 'vitest'

import { CONFIG_FILE, parseRepoConfig, readRepoConfig } from './config.mts'

describe('parseRepoConfig', () => {
  it('treats a missing or empty config as nothing declared', () => {
    expect(parseRepoConfig(undefined)).toEqual({ consumes: [], problems: [] })
    expect(parseRepoConfig('{}')).toEqual({ consumes: [], problems: [] })
  })

  it('reads consumed repositories with optional paths and via', () => {
    const text = JSON.stringify({
      consumes: [
        { repo: 'Acme/API', paths: ['src/routes/**'], via: ' HTTP\n API ' },
        { repo: 'acme/schema' },
      ],
    })
    expect(parseRepoConfig(text)).toEqual({
      consumes: [
        { repo: 'acme/api', paths: ['src/routes/**'], via: 'HTTP API' },
        { repo: 'acme/schema', paths: [], via: '' },
      ],
      problems: [],
    })
  })

  it('reports invalid JSON and non-object files', () => {
    expect(parseRepoConfig('{')).toEqual({
      consumes: [],
      problems: [`${CONFIG_FILE}: not valid JSON; ignored`],
      unreadable: true,
    })
    expect(parseRepoConfig('[]')).toEqual({
      consumes: [],
      problems: [`${CONFIG_FILE}: must be a JSON object; ignored`],
      unreadable: true,
    })
  })

  it('reports unknown keys and a non-array consumes', () => {
    expect(parseRepoConfig('{"consume": [], "consumes": {}}')).toEqual({
      consumes: [],
      problems: [
        `${CONFIG_FILE}: unknown key "consume" ignored`,
        `${CONFIG_FILE}: "consumes" must be an array`,
      ],
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
    const where = `${CONFIG_FILE} consumes`
    expect(parseRepoConfig(text)).toEqual({
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

describe('readRepoConfig', () => {
  it('reads the config file from a rule source and survives a failing read', async () => {
    const reader = {
      label: 'mem',
      list: async () => [],
      read: async (path: string) =>
        path === CONFIG_FILE ? '{"consumes":[{"repo":"a/b"}]}' : undefined,
    }
    expect((await readRepoConfig(reader)).consumes).toEqual([{ repo: 'a/b', paths: [], via: '' }])
    const broken = { ...reader, read: async () => Promise.reject(new Error('boom')) }
    expect(await readRepoConfig(broken)).toEqual({ consumes: [], problems: [] })
  })
})

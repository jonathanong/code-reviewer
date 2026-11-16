import { describe, expect, it } from 'vitest'

import { NO_CONFIGS, parseRepoConfig, type RepoConfigs } from './config.mts'
import { declaredLinks, type Linkable } from './declared.mts'

function configs(files: Record<string, unknown>): RepoConfigs {
  const byRepo = new Map(
    Object.entries(files).map(([repo, config]) => [
      repo,
      parseRepoConfig(JSON.stringify(config), `${repo}.json`),
    ]),
  )
  return { byRepo, byOwner: new Map(), problems: [] }
}

const candidate = (name: string, repo?: string): Linkable => ({
  name,
  ...(repo === undefined ? {} : { repo }),
})

describe('declaredLinks dependencies', () => {
  it('resolves consumed repositories by origin, or by directory name without one', () => {
    const links = declaredLinks({
      repoId: 'Acme/Web',
      configs: configs({
        'acme/web': {
          consumes: [
            { repo: 'acme/api', via: 'HTTP API', paths: ['routes/**', 'openapi.json'] },
            { repo: 'acme/schema' },
            { repo: 'acme/api' },
            { repo: 'acme/gone' },
            { repo: 'other/fork' },
          ],
        },
      }),
      candidates: [
        candidate('api'),
        candidate('api-checkout', 'Acme/API'),
        candidate('schema'),
        candidate('fork', 'acme/fork'),
      ],
      changedPaths: [],
    })
    expect(links).toEqual({
      deps: [
        {
          name: 'api-checkout',
          heading: 'api-checkout: consumed via HTTP API (routes/**, openapi.json)',
        },
        { name: 'schema', heading: 'schema: consumed' },
      ],
      consumers: [],
      missing: [
        'acme/gone: configured as consumed, but no clone of it was found',
        'other/fork: configured as consumed, but no clone of it was found',
      ],
    })
  })

  it('links nothing for an unknown or unconfigured repository', () => {
    const all = configs({ 'acme/web': { consumes: [{ repo: 'acme/api' }] } })
    const none = { deps: [], consumers: [], missing: [] }
    const candidates = [candidate('api'), candidate('web')]
    expect(declaredLinks({ configs: all, candidates, changedPaths: ['a'] })).toEqual(none)
    expect(
      declaredLinks({ repoId: 'acme/other', configs: NO_CONFIGS, candidates, changedPaths: ['a'] }),
    ).toEqual(none)
  })
})

describe('declaredLinks consumers', () => {
  const all = configs({
    'acme/web': {
      consumes: [
        { repo: 'acme/api', via: 'HTTP API', paths: ['docs/**', 'src/routes/**'] },
        { repo: 'acme/api' },
      ],
    },
    'acme/ios': { consumes: [{ repo: 'acme/api' }] },
    'acme/cli': { consumes: [{ repo: 'acme/api', paths: ['proto/**'] }] },
    'acme/other': { consumes: [{ repo: 'acme/elsewhere' }] },
    'acme/uncloned': { consumes: [{ repo: 'acme/api', paths: ['src/**'] }] },
  })
  const candidates = [
    candidate('web-checkout', 'acme/web'),
    candidate('ios'),
    candidate('cli', 'acme/cli'),
    candidate('other', 'acme/other'),
  ]

  it('finds the repositories that consume what the change touches', () => {
    const links = declaredLinks({
      repoId: 'Acme/Api',
      configs: all,
      candidates,
      changedPaths: ['README.md', 'src/routes/users.ts'],
    })
    expect(links).toEqual({
      deps: [],
      consumers: [
        {
          name: 'web-checkout',
          heading:
            'web-checkout: consumes this repository via HTTP API (docs/**, src/routes/**); this change touches src/routes/users.ts',
        },
        { name: 'ios', heading: 'ios: consumes this repository; this change touches README.md' },
      ],
      missing: ['acme/uncloned: configured as a consumer, but no clone of it was found'],
    })
  })

  it('finds none when nothing changed', () => {
    const links = declaredLinks({
      repoId: 'acme/api',
      configs: all,
      candidates,
      changedPaths: [],
    })
    expect(links).toEqual({ deps: [], consumers: [], missing: [] })
  })

  it('counts the path a rename moved a file away from', () => {
    const links = declaredLinks({
      repoId: 'acme/api',
      configs: all,
      candidates,
      changedPaths: ['lib/users.ts'],
      diff: 'diff --git a/proto/a.proto b/lib/users.ts\nrename from proto/a.proto\nrename to lib/users.ts\n',
    })
    expect(links.consumers.map((link) => link.heading)).toEqual([
      'web-checkout: consumes this repository; this change touches lib/users.ts',
      'ios: consumes this repository; this change touches lib/users.ts',
      'cli: consumes this repository (proto/**); this change touches proto/a.proto',
    ])
  })
})

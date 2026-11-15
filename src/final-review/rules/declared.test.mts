import { describe, expect, it } from 'vitest'

import { CONFIG_FILE } from './config.mts'
import { declaredLinks, type Linkable } from './declared.mts'
import type { RuleReader } from './reader.mts'

function reader(config?: unknown): RuleReader {
  return {
    label: 'mem',
    list: async () => [],
    read: async (path) =>
      path === CONFIG_FILE && config !== undefined ? JSON.stringify(config) : undefined,
  }
}

const candidate = (name: string, repo?: string, config?: unknown): Linkable => ({
  name,
  ...(repo === undefined ? {} : { repo }),
  reader: reader(config),
})

describe('declaredLinks dependencies', () => {
  it('resolves consumed repositories by origin, or by directory name without one', async () => {
    const links = await declaredLinks({
      repo: {
        reader: reader({
          consumes: [
            { repo: 'acme/api', via: 'HTTP API', paths: ['routes/**', 'openapi.json'] },
            { repo: 'acme/schema' },
            { repo: 'acme/api' },
            { repo: 'acme/gone' },
            { repo: 'other/fork' },
          ],
        }),
      },
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
        'acme/gone: declared as consumed, but no clone of it was found',
        'other/fork: declared as consumed, but no clone of it was found',
      ],
    })
  })

  it('reports config problems and does nothing without a repository', async () => {
    const bad: RuleReader = { ...reader(), read: async () => '{' }
    expect(
      await declaredLinks({ repo: { reader: bad }, candidates: [], changedPaths: [] }),
    ).toEqual({
      deps: [],
      consumers: [],
      missing: [`This repository: ${CONFIG_FILE}: not valid JSON; ignored`],
    })
    expect(
      await declaredLinks({
        candidates: [candidate('web', 'acme/web', { consumes: [{ repo: 'acme/api' }] })],
        changedPaths: ['a'],
      }),
    ).toEqual({ deps: [], consumers: [], missing: [] })
  })
})

describe('declaredLinks consumers', () => {
  const candidates = [
    candidate('web', 'acme/web', {
      consumes: [
        { repo: 'acme/api', via: 'HTTP API', paths: ['docs/**', 'src/routes/**'] },
        { repo: 'acme/api' },
      ],
    }),
    candidate('ios', 'acme/ios', { consumes: [{ repo: 'ACME/api' }] }),
    candidate('cli', 'acme/cli', { consumes: [{ repo: 'acme/api', paths: ['proto/**'] }] }),
    candidate('other', 'acme/other', { consumes: [{ repo: 'acme/elsewhere' }], extra: 1 }),
    candidate('noted', 'acme/noted', {
      consumes: [{ repo: 'acme/api', paths: ['x/**'] }],
      extra: 1,
    }),
    { name: 'broken', reader: { ...reader(), read: async () => '[]' } },
  ]

  it('finds candidates that consume what the change touches', async () => {
    const links = await declaredLinks({
      repoId: 'Acme/Api',
      candidates,
      changedPaths: ['README.md', 'src/routes/users.ts'],
    })
    expect(links).toEqual({
      deps: [],
      consumers: [
        {
          name: 'web',
          heading:
            'web: consumes this repository via HTTP API (docs/**, src/routes/**); this change touches src/routes/users.ts',
        },
        { name: 'ios', heading: 'ios: consumes this repository; this change touches README.md' },
      ],
      missing: [
        `noted: ${CONFIG_FILE}: unknown key "extra" ignored`,
        `broken: ${CONFIG_FILE}: must be a JSON object; ignored`,
      ],
    })
  })

  it('finds none when nothing changed', async () => {
    const links = await declaredLinks({
      repoId: 'acme/api',
      candidates,
      changedPaths: [],
    })
    expect(links.consumers).toEqual([])
  })

  it('counts the path a rename moved a file away from', async () => {
    const links = await declaredLinks({
      repoId: 'acme/api',
      candidates,
      changedPaths: ['src/v2/users.ts'],
      diff: 'diff --git a/proto/a.proto b/src/v2/users.ts\nrename from proto/a.proto\nrename to src/v2/users.ts\n',
    })
    expect(links.consumers.map((link) => link.heading)).toEqual([
      'web: consumes this repository; this change touches src/v2/users.ts',
      'ios: consumes this repository; this change touches src/v2/users.ts',
      'cli: consumes this repository (proto/**); this change touches proto/a.proto',
    ])
  })
})

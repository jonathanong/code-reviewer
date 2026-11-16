import { describe, expect, it } from 'vitest'

import type { RuleReader } from './reader.mts'
import { findRelated } from './related.mts'

function reader(files: Record<string, string | undefined>): RuleReader {
  return {
    label: 'mem',
    list: async () => Object.keys(files),
    read: async (path) => files[path],
  }
}

const pkg = (name: unknown) => JSON.stringify({ name })

function candidate(name: string, files: Record<string, string | undefined>) {
  return { name, reader: reader(files), codeHint: `hint ${name}` }
}

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1,2 @@',
  " import { x } from 'unrelated'",
  "+import { y } from '@acme/widgets/server'",
  '--- "@acme/ignored"',
  'diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml',
  '+++ b/.github/workflows/ci.yml',
  '+      - uses: acme/setup-thing@v1',
  '+      - uses: acme/setup-things@v1',
].join('\n')

describe('findRelated', () => {
  it('matches quoted module specifiers from root and workspace package.json files', async () => {
    const related = await findRelated(
      [
        candidate('widgets', {
          'package.json': pkg('@acme/widgets'),
          'packages/ui/package.json': pkg('@acme/ui'),
        }),
        candidate('ignored', { 'package.json': pkg('@acme/ignored') }),
        candidate('lookalike', { 'package.json': pkg('@acme/widget') }),
      ],
      DIFF,
    )
    expect(related).toEqual([{ name: 'widgets', packages: ['@acme/widgets'], where: 'src/a.ts' }])
  })

  it('matches owner/name in a uses line and escapes regex characters', async () => {
    const related = await findRelated(
      [
        candidate('setup-thing', {}),
        candidate('setup-th.ng', {}),
        candidate('dotted', { 'package.json': pkg('a.b') }),
      ],
      `${DIFF}\n+import 'axb'`,
    )
    expect(related).toEqual([
      { name: 'setup-thing', packages: [], where: '.github/workflows/ci.yml' },
    ])
  })

  it('keeps the first matching path when a package and a uses line both match', async () => {
    const related = await findRelated(
      [candidate('setup-thing', { 'package.json': pkg('@acme/widgets') })],
      DIFF,
    )
    expect(related).toEqual([
      { name: 'setup-thing', packages: ['@acme/widgets'], where: 'src/a.ts' },
    ])
  })

  it('skips the excluded repo, bad package.json files, and caps at five', async () => {
    const many = Array.from({ length: 7 }, (_v, i) =>
      candidate(`r${i}`, { 'package.json': pkg(`pkg${i}`) }),
    )
    const diff = `diff --git a/x.ts b/x.ts\n+${many.map((_c, i) => `from "pkg${i}"`).join(' ')}`
    const bad = [
      candidate('self', { 'package.json': pkg('pkg0') }),
      candidate('broken', { 'package.json': '{' }),
      candidate('nameless', { 'package.json': pkg(7) }),
      candidate('empty', { 'package.json': pkg('') }),
      candidate('missing', { 'package.json': undefined }),
    ]
    const related = await findRelated([...bad, ...many], diff, 'self')
    expect(related.map((item) => item.name)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
  })
})

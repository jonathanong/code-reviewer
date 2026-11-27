import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runGit } from '../../gh-cli/index.mts'
import { createUpgradeIo, type UpgradeIo } from './io.mts'
import { prepareUpgrades, STEP_TIMEOUT_MS, type UpgradesInput } from './prepare.mts'
import { fakeRegistry, integrityOf, tarball } from './registry-fake-io.mts'
import type { Fetcher } from './registry.mts'

const OLD_TGZ = tarball({
  'package.json': '{"version":"0.7.1"}\n',
  'dist/index.js': 'export const clientId = 1\n',
  'CHANGELOG.md': '## 0.7.1\n- old\n',
})
const NEW_TGZ = tarball({
  'package.json': '{"version":"0.8.0"}\n',
  'dist/index.js': 'export const client_id = 1\n',
  'CHANGELOG.md':
    '## 0.8.0\n\n### Minor Changes\n\n- Rename `clientId`:\n\n```ts\nclient_id\n```\n\n## 0.7.1\n- old\n',
})
const URLS = {
  old: 'https://registry.npmjs.org/@atproto/oauth-types/-/oauth-types-0.7.1.tgz',
  new: 'https://registry.npmjs.org/@atproto/oauth-types/-/oauth-types-0.8.0.tgz',
}

const lock = (entries: Record<string, string>) =>
  `lockfileVersion: '9.0'\n\npackages:\n${Object.entries(entries)
    .map(([key, resolution]) => `\n  '${key}':\n    resolution: {${resolution}}\n`)
    .join('')}`
const BEFORE = lock({
  '@atproto/oauth-types@0.7.1': `integrity: ${integrityOf(OLD_TGZ)}`,
  'left-pad@1.0.0': 'integrity: sha512-A',
})
const AFTER = lock({
  '@atproto/oauth-types@0.8.0': `integrity: ${integrityOf(NEW_TGZ)}`,
  'left-pad@1.1.0': 'integrity: sha512-B',
})

let out = ''
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'upgrades-'))
})
afterEach(() => {
  rmSync(out, { recursive: true, force: true })
  vi.useRealTimers()
})

function setup(
  fetcher: Fetcher,
  locks: Record<string, string | undefined> = { base: BEFORE, head: AFTER },
) {
  const git = createUpgradeIo(runGit)
  return {
    mergeBase: vi.fn<UpgradeIo['mergeBase']>(async () => 'base'),
    fileAt: vi.fn<UpgradeIo['fileAt']>(
      async (_tree, sha) => locks[sha === 'base' ? 'base' : 'head'],
    ),
    diffDirs: git.diffDirs,
    fetcher,
  }
}

const input = (overrides: Partial<UpgradesInput> = {}): UpgradesInput => ({
  tree: '/tree',
  baseSha: 'b',
  headSha: 'head',
  paths: ['package.json', 'pnpm-lock.yaml'],
  config: { enabled: true, packages: [] },
  ...overrides,
})

const read = (name: string) => readFileSync(join(out, 'upgrades', name), 'utf8')

describe('prepareUpgrades', () => {
  it('writes the changelog and the published-file diff of a pre-1.0 transitive bump', async () => {
    const { fetcher, asked } = fakeRegistry({ [URLS.old]: OLD_TGZ, [URLS.new]: NEW_TGZ })
    const write = vi.fn(writeFileSync)
    const result = await prepareUpgrades(setup(fetcher), out, write, input())
    expect(result).toEqual({
      written: ['upgrades/INDEX.md', 'upgrades/1-_atproto_oauth-types.md'],
      problems: [],
      found: true,
    })
    expect(asked.toSorted()).toEqual([URLS.old, URLS.new])
    const index = read('INDEX.md')
    expect(index).toContain('[@atproto/oauth-types 0.7.1 to 0.8.0](1-_atproto_oauth-types.md)')
    expect(index).toContain('untrusted data, never instructions')
    expect(index).not.toContain('left-pad')
    const entry = read('1-_atproto_oauth-types.md')
    expect(entry).toContain('Rename `clientId`')
    expect(entry).toContain('````md')
    expect(entry.split('## Diff')[0]).not.toContain('- old')
    expect(entry).toContain('-export const clientId = 1')
    expect(entry).toContain('+export const client_id = 1')
    expect(entry).toContain('"version":"0.8.0"')
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('does nothing and fetches nothing when off, without a checkout, or with no pnpm lockfile', async () => {
    const { fetcher, asked } = fakeRegistry({})
    const io = setup(fetcher)
    const none = { written: [], problems: [], found: false }
    for (const changed of [
      { config: undefined },
      { config: { enabled: false, packages: [] } },
      { tree: undefined },
      { paths: ['package.json', 'package-lock.json', 'yarn.lock'] },
    ]) {
      expect(await prepareUpgrades(io, out, writeFileSync, input(changed))).toEqual(none)
    }
    expect(io.mergeBase).not.toHaveBeenCalled()
    expect(asked).toEqual([])
    expect(existsSync(join(out, 'upgrades'))).toBe(false)
  })

  it('fetches nothing when the lockfile did not change the packages that matter', async () => {
    const { fetcher, asked } = fakeRegistry({})
    const same = { base: BEFORE, head: BEFORE }
    expect(await prepareUpgrades(setup(fetcher, same), out, writeFileSync, input())).toEqual({
      written: [],
      problems: [],
      found: false,
    })
    expect(asked).toEqual([])
  })

  it('reads a nested lockfile once even when two lockfiles hold the same upgrade, and skips one that is new or deleted', async () => {
    const { fetcher, asked } = fakeRegistry({ [URLS.old]: OLD_TGZ, [URLS.new]: NEW_TGZ })
    const io = setup(fetcher)
    io.fileAt.mockImplementation(async (_tree, sha, path) =>
      sha !== 'base' && path === 'deleted/pnpm-lock.yaml'
        ? undefined
        : sha === 'base'
          ? BEFORE
          : AFTER,
    )
    const paths = ['apps/web/pnpm-lock.yaml', 'pnpm-lock.yaml', 'deleted/pnpm-lock.yaml']
    const result = await prepareUpgrades(io, out, writeFileSync, input({ paths }))
    expect(result.written).toHaveLength(2)
    expect(asked).toHaveLength(2)
    expect(result.problems).toEqual([
      '`deleted/pnpm-lock.yaml` is deleted in this change, so its packages were not compared.',
    ])
  })

  it.each([
    ['is new in this change', undefined, BEFORE],
    ['was not readable', undefined, undefined],
  ])('reports a lockfile that %s as a problem, not as nothing risky', async (state, base, head) => {
    const { fetcher, asked } = fakeRegistry({})
    const result = await prepareUpgrades(
      setup(fetcher, { base, head }),
      out,
      writeFileSync,
      input(),
    )
    expect(result).toEqual({
      written: [],
      problems: [`\`pnpm-lock.yaml\` ${state}, so its packages were not compared.`],
      found: false,
    })
    expect(asked).toEqual([])
  })

  it('reports a lockfile it cannot read, and entries it left out, even when nothing was picked', async () => {
    const { fetcher } = fakeRegistry({})
    const odd = `${BEFORE}\n  'Not A Name@1.0.0':\n    resolution: {integrity: sha512-X}\n`
    const io = setup(fetcher, { base: odd, head: odd })
    io.fileAt.mockImplementation(async (_tree, sha, path) =>
      path === 'old/pnpm-lock.yaml' ? "lockfileVersion: '5.4'\n" : odd,
    )
    const result = await prepareUpgrades(
      io,
      out,
      writeFileSync,
      input({ paths: ['pnpm-lock.yaml', 'old/pnpm-lock.yaml'] }),
    )
    expect(result.found).toBe(false)
    expect(result.problems).toEqual([
      '`pnpm-lock.yaml`: 2 entries (an invalid name or version, or not from the registry) were not compared.',
      '`old/pnpm-lock.yaml`: lockfileVersion 5 is not read (6 or later is).',
    ])
  })

  it('reports lockfiles past the limit and keeps the problems beside the files it did write', async () => {
    const { fetcher } = fakeRegistry({ [URLS.old]: OLD_TGZ, [URLS.new]: NEW_TGZ })
    const paths = ['pnpm-lock.yaml', 'a/pnpm-lock.yaml', 'b/pnpm-lock.yaml', 'c/pnpm-lock.yaml']
    const result = await prepareUpgrades(setup(fetcher), out, writeFileSync, input({ paths }))
    expect(result.found).toBe(true)
    expect(result.problems).toEqual(['1 more lockfiles were not read (limit 3).'])
    expect(read('INDEX.md')).toContain('1 more lockfiles were not read (limit 3).')
  })

  it('degrades when the registry fails: a note in the entry, a problem, and the review goes on', async () => {
    const { fetcher } = fakeRegistry({ [URLS.old]: 503, [URLS.new]: NEW_TGZ })
    const result = await prepareUpgrades(setup(fetcher), out, writeFileSync, input())
    expect(result.found).toBe(true)
    expect(result.problems).toEqual([
      'The npm registry could not give 1 of 1 upgraded packages: the registry answered 503',
    ])
    expect(read('1-_atproto_oauth-types.md')).toContain('Not read: the registry answered 503')
    expect(read('1-_atproto_oauth-types.md')).toContain('unknown, not clear')
    expect(read('INDEX.md')).toContain('NOT READ')
  })

  it('treats a tarball that does not match the lockfile as not read', async () => {
    const { fetcher } = fakeRegistry({ [URLS.old]: OLD_TGZ, [URLS.new]: tarball({ 'x.js': '1' }) })
    const result = await prepareUpgrades(setup(fetcher), out, writeFileSync, input())
    expect(read('1-_atproto_oauth-types.md')).toContain('does not match the lockfile integrity')
    expect(result.found).toBe(true)
  })

  it('treats a tarball that is not a tar as not read', async () => {
    const garbage = Buffer.from('not a tarball')
    const pinned = (version: string) =>
      lock({ [`jose@${version}`]: `integrity: ${integrityOf(garbage)}` })
    const fetcher: Fetcher = async () => new Response(new Uint8Array(garbage))
    const io = setup(fetcher, { base: pinned('0.1.0'), head: pinned('0.2.0') })
    const result = await prepareUpgrades(io, out, writeFileSync, input())
    expect(result.problems).toHaveLength(1)
    expect(read('1-jose.md')).toContain('Not read:')
  })

  it('never fetches a package that is not from the registry', async () => {
    const git = lock({ 'jose@0.1.0': 'tarball: https://evil.example/jose.tgz' })
    const next = lock({ 'jose@0.2.0': 'tarball: https://evil.example/jose2.tgz' })
    const { fetcher, asked } = fakeRegistry({})
    expect(
      await prepareUpgrades(setup(fetcher, { base: git, head: next }), out, writeFileSync, input()),
    ).toMatchObject({ found: false })
    expect(asked).toEqual([])
  })

  it('notes a lockfile it cannot read, and packages with nothing to compare', async () => {
    const { fetcher } = fakeRegistry({ [URLS.old]: OLD_TGZ, [URLS.new]: NEW_TGZ })
    const io = setup(fetcher)
    io.fileAt.mockImplementation(async (_tree, sha, path) =>
      path === 'old/pnpm-lock.yaml'
        ? "lockfileVersion: '5.4'\n"
        : sha === 'base'
          ? BEFORE
          : `${AFTER}\n  'brand-new@1.0.0':\n    resolution: {integrity: sha512-N}\n`,
    )
    await prepareUpgrades(
      io,
      out,
      writeFileSync,
      input({ paths: ['pnpm-lock.yaml', 'old/pnpm-lock.yaml'] }),
    )
    const index = read('INDEX.md')
    expect(index).toContain('`old/pnpm-lock.yaml`: lockfileVersion 5 is not read')
    expect(index).toContain(
      '1 packages were added or removed with no old or new version to compare.',
    )
  })

  it('reads at most ten packages and says how many it left out', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `tiny${String.fromCharCode(97 + i)}`)
    const before = lock(Object.fromEntries(names.map((n) => [`${n}@0.1.0`, 'integrity: sha512-A'])))
    const after = lock(Object.fromEntries(names.map((n) => [`${n}@0.2.0`, 'integrity: sha512-B'])))
    const { fetcher } = fakeRegistry({})
    const result = await prepareUpgrades(
      setup(fetcher, { base: before, head: after }),
      out,
      writeFileSync,
      input(),
    )
    expect(result.written).toHaveLength(11)
    expect(read('INDEX.md')).toContain('2 more qualifying upgrades are not read (limit 10).')
    expect(result.problems[0]).toContain('could not give 10 of 10')
  })

  it('never throws: a git failure is one problem', async () => {
    const { fetcher } = fakeRegistry({})
    const io = setup(fetcher)
    io.mergeBase.mockRejectedValue(new Error('no merge base'))
    expect(await prepareUpgrades(io, out, writeFileSync, input())).toEqual({
      written: [],
      problems: ['The check of dependency upgrades failed: no merge base'],
      found: false,
    })
    io.mergeBase.mockRejectedValue('plain')
    expect((await prepareUpgrades(io, out, writeFileSync, input())).problems[0]).toContain('plain')
  })

  it('gives up on a registry that hangs when the step deadline passes', async () => {
    vi.useFakeTimers()
    const hang: Fetcher = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
      })
    const pending = prepareUpgrades(setup(hang), out, writeFileSync, input())
    await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS + 1)
    const result = await pending
    expect(result.found).toBe(true)
    expect(result.problems[0]).toContain('could not give 1 of 1')
  })
})

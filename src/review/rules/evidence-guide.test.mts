import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGuideReader } from './evidence-guide.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const HOME = fileURLToPath(new URL('./fixtures/home', import.meta.url))
const GUIDE_TEXT = '# Production data'

function clones(names: string[], plain: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'guide-clones-'))
  dirs.push(root)
  for (const name of names) mkdirSync(join(root, name, '.git'), { recursive: true })
  for (const name of plain) mkdirSync(join(root, name), { recursive: true })
  return root
}

type GitOptions = { origins?: Record<string, string>; ref?: string; files?: Record<string, string> }

/** A fake git that answers the three calls the reader makes: origin url, default ref, show. */
function fakeGit({ origins = {}, ref = 'origin/main', files = {} }: GitOptions) {
  return vi.fn(async (args: string[]) => {
    if (args.includes('get-url')) {
      const url = origins[(args[1] as string).split('/').at(-1) as string]
      if (url === undefined) throw new Error('no origin')
      return `${url}\n`
    }
    if (args.includes('--abbrev-ref')) return `${ref}\n`
    const shown = args.at(-1) as string
    const file = files[shown]
    if (file === undefined) throw new Error('missing')
    return file
  })
}

const GUIDE = { repo: 'acme/infra', path: 'docs/production-data.md' }

describe('createGuideReader file guides', () => {
  it('reads an absolute path and expands ~/ to the home directory', async () => {
    const read = createGuideReader({ clones: undefined, git: fakeGit({}), home: HOME })
    expect(await read({ file: '~/guides/aws.md' })).toContain('/app/api')
    expect(await read({ file: join(HOME, 'guides/aws.md') })).toContain('/app/api')
  })

  it('defaults the home directory when none is injected', async () => {
    const read = createGuideReader({ clones: undefined, git: fakeGit({}) })
    await expect(read({ file: join(HOME, 'guides/aws.md') })).resolves.toContain('/app/api')
  })

  it('rejects a missing or empty file', async () => {
    const read = createGuideReader({ clones: undefined, git: fakeGit({}), home: HOME })
    await expect(read({ file: '~/guides/missing.md' })).rejects.toThrow('missing.md')
    await expect(read({ file: '~/guides/empty.md' })).rejects.toThrow('the guide is empty')
  })
})

describe('createGuideReader repository guides', () => {
  const files = { 'origin/main:docs/production-data.md': GUIDE_TEXT }

  it('reads the file from the clone whose origin is the repository, at its default branch', async () => {
    const root = clones(['zz-other', 'infra-clone'], ['a-not-a-repo'])
    const git = fakeGit({
      origins: {
        'zz-other': 'https://github.com/acme/web.git',
        'infra-clone': 'git@github.com:Acme/Infra.git',
      },
      files,
    })
    expect(await createGuideReader({ clones: root, git })(GUIDE)).toBe(GUIDE_TEXT)
    const shows = git.mock.calls.filter(([args]) => args.includes('show'))
    expect(shows).toEqual([
      [['-C', join(root, 'infra-clone'), 'show', 'origin/main:docs/production-data.md']],
    ])
  })

  it('needs a clone root', async () => {
    await expect(createGuideReader({ clones: undefined, git: fakeGit({}) })(GUIDE)).rejects.toThrow(
      'no clone root',
    )
  })

  it('fails when no clone has that origin', async () => {
    const root = clones(['web'])
    const git = fakeGit({ origins: { web: 'git@github.com:acme/web.git' } })
    await expect(createGuideReader({ clones: root, git })(GUIDE)).rejects.toThrow(
      'no clone of acme/infra under the clone root',
    )
  })

  it('rejects an oversized guide', async () => {
    const root = clones(['infra'])
    const git = fakeGit({
      origins: { infra: 'git@github.com:acme/infra.git' },
      files: { 'origin/main:docs/production-data.md': 'x'.repeat(64_001) },
    })
    await expect(createGuideReader({ clones: root, git })(GUIDE)).rejects.toThrow(
      'the guide is over 64000 characters',
    )
  })

  it('never reads a clone that has no remote default branch, since HEAD may be a pull request', async () => {
    const root = clones(['infra'])
    // No origin/HEAD and no origin/main: the default ref falls back to HEAD.
    const git = vi.fn(async (args: string[]) => {
      if (args.includes('get-url')) return 'git@github.com:acme/infra.git\n'
      throw new Error('no ref')
    })
    await expect(createGuideReader({ clones: root, git })(GUIDE)).rejects.toThrow(
      'has no remote default branch',
    )
    expect(git.mock.calls.some(([args]) => args.includes('show'))).toBe(false)
  })

  it('fails when the file is not on the default branch', async () => {
    const root = clones(['infra'])
    const git = fakeGit({ origins: { infra: 'git@github.com:acme/infra.git' } })
    await expect(createGuideReader({ clones: root, git })(GUIDE)).rejects.toThrow(
      'docs/production-data.md is not on origin/main of acme/infra',
    )
  })
})

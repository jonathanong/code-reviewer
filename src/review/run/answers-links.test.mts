import { describe, expect, it } from 'vitest'

import { pluginLocation, skillUrl } from './answers-links.mts'
import { pluginHome, type HomeOptions } from './plugin-home-fake-io.mts'

const GITHUB = { source: 'github', repo: 'acme/market' }
const where = (options: HomeOptions) => pluginLocation(pluginHome(options))

describe('pluginLocation', () => {
  it('puts a plugin at the root of the marketplace repository for a source of ./', () => {
    expect(where({ source: GITHUB, entry: './' })).toEqual({
      repository: 'https://github.com/acme/market',
      ref: 'HEAD',
      dir: '',
    })
  })

  it('puts a plugin at a relative path of the marketplace repository, at the ref it was added at', () => {
    expect(
      where({
        source: { source: 'git', url: 'https://github.com/acme/market.git', ref: 'stable' },
        entry: './plugins/rules/',
      }),
    ).toEqual({ repository: 'https://github.com/acme/market', ref: 'stable', dir: 'plugins/rules' })
  })

  it.each([
    [
      'a git-subdir source with its own url and path',
      {
        source: 'git-subdir',
        url: 'https://github.com/acme/rules.git',
        path: 'plugins/rules',
        ref: 'main',
      },
      { repository: 'https://github.com/acme/rules', ref: 'main', dir: 'plugins/rules' },
    ],
    [
      'a url source without a path',
      { source: 'url', url: 'https://github.com/acme/rules' },
      { repository: 'https://github.com/acme/rules', ref: 'HEAD', dir: '' },
    ],
    [
      'a github source',
      { source: 'github', repo: 'acme/rules', ref: 'a b' },
      { repository: 'https://github.com/acme/rules', ref: 'HEAD', dir: '' },
    ],
  ])('takes the repository and directory of %s', (_name, entry, expected) => {
    expect(where({ source: GITHUB, entry })).toEqual(expected)
  })

  it.each([
    ['an install with no marketplace', { marketplace: null, source: GITHUB, entry: './' }],
    ['an install outside a plugin cache', { marketplace: 'other', source: GITHUB, entry: './' }],
    ['a marketplace that is not known', { unknown: true, entry: './' }],
    ['a marketplace with no source', { entry: './' }],
    [
      'a marketplace that is not on GitHub',
      { source: { source: 'git', url: 'https://gitlab.com/a/b' }, entry: './' },
    ],
    ['a marketplace source with no url', { source: { source: 'directory' }, entry: './' }],
    ['a marketplace.json that is not JSON', { source: GITHUB, rawCatalog: '{' }],
    ['a marketplace.json that is a list', { source: GITHUB, rawCatalog: '[]' }],
    [
      'a marketplace with a pluginRoot',
      { source: GITHUB, entry: 'rules', catalog: { metadata: { pluginRoot: './plugins' } } },
    ],
    ['a marketplace that does not list the plugin', { source: GITHUB }],
    ['a marketplace whose plugins is not a list', { source: GITHUB, catalog: { plugins: 'x' } }],
    ['a source that leaves the repository', { source: GITHUB, entry: '../elsewhere' }],
    ['a source with a strange path', { source: GITHUB, entry: './a b' }],
    ['a source that is a number', { source: GITHUB, entry: 7 }],
    ['an npm source', { source: GITHUB, entry: { source: 'npm', package: 'rules' } }],
    [
      'an object source on another host',
      { source: GITHUB, entry: { url: 'https://gitlab.com/a/b' } },
    ],
    [
      'an object source with a path that leaves the repository',
      { source: GITHUB, entry: { url: 'https://github.com/a/b', path: '../x' } },
    ],
    [
      'an object source with a path that is not text',
      { source: GITHUB, entry: { url: 'https://github.com/a/b', path: 3 } },
    ],
  ] as [string, HomeOptions][])('gives no location for %s', (_name, options) => {
    expect(where(options)).toBeUndefined()
  })

  it('reads a marketplace entry that has no known_marketplaces.json at all as unknown', () => {
    const install = pluginHome({ source: GITHUB, entry: './' })
    expect(
      pluginLocation({ ...install, installPath: '/nowhere/cache/market/rules/1' }),
    ).toBeUndefined()
  })
})

describe('skillUrl', () => {
  const file = '/cache/rules/1/skills/locks/SKILL.md'

  it('points at the skill directory of the file, below the plugin directory', () => {
    const root = { repository: 'https://github.com/o/r', ref: 'HEAD', dir: '' }
    expect(skillUrl(root, file)).toBe('https://github.com/o/r/blob/HEAD/skills/locks/SKILL.md')
    expect(skillUrl({ ...root, dir: 'plugins/rules', ref: 'main' }, file)).toBe(
      'https://github.com/o/r/blob/main/plugins/rules/skills/locks/SKILL.md',
    )
  })

  it('invents nothing without a location', () => {
    expect(skillUrl(undefined, file)).toBeUndefined()
  })
})

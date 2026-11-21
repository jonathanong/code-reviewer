import { describe, expect, it } from 'vitest'

import { isToolConfig, kindOf, topDir } from './classify.mts'

describe('kindOf', () => {
  it.each([
    ['pnpm-lock.yaml', 'lockfile'],
    ['dist/app.js', 'generated'],
    ['src/a.test.ts', 'test'],
    ['docs/guide.md', 'docs'],
    ['.oxlintrc.json', 'config'],
    ['.github/workflows/ci.yml', 'config'],
    ['package.json', 'config'],
    ['src/a.ts', 'source'],
  ])('classifies %s as %s', (path, kind) => {
    expect(kindOf(path)).toBe(kind)
  })
})

describe('isToolConfig', () => {
  it.each([
    '.oxlintrc.json',
    'eslint.config.mjs',
    'pkg/.prettierrc.yaml',
    'tsconfig.build.json',
    'rustfmt.toml',
    'clippy.toml',
    'biome.json',
  ])('accepts %s', (path) => {
    expect(isToolConfig(path)).toBe(true)
  })

  it('rejects ordinary files', () => {
    expect(isToolConfig('src/tsconfig-helper.ts')).toBe(false)
    expect(isToolConfig('package.json')).toBe(false)
  })
})

describe('topDir', () => {
  it('is the first segment, or (root) for a root file', () => {
    expect(topDir('src/a/b.ts')).toBe('src')
    expect(topDir('README.md')).toBe('(root)')
  })
})

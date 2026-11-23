import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { pluginRepository, skillUrl } from './answers-links.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function plugin(manifest: string | undefined): string {
  const root = mkdtempSync(join(tmpdir(), 'answers-links-'))
  dirs.push(root)
  if (manifest !== undefined) {
    mkdirSync(join(root, '.claude-plugin'))
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), manifest)
  }
  return root
}
const repository = (value: unknown) => plugin(JSON.stringify({ repository: value }))

describe('pluginRepository', () => {
  it.each([
    ['a string', 'https://github.com/o/r'],
    ['a string with .git and a slash', 'https://github.com/o/r.git/'],
    ['an object with a url', { type: 'git', url: 'https://github.com/o/r.git' }],
  ])('reads the GitHub repository from %s', (_name, value) => {
    expect(pluginRepository(repository(value))).toBe('https://github.com/o/r')
  })

  it.each([
    ['another host', 'https://gitlab.com/o/r'],
    ['a plain http link', 'http://github.com/o/r'],
    ['a deeper path', 'https://github.com/o/r/tree/main'],
    ['a number', 7],
    ['an object without a url', {}],
    ['null', null],
  ])('gives nothing for %s', (_name, value) => {
    expect(pluginRepository(repository(value))).toBeUndefined()
  })

  it('gives nothing for a manifest that is missing, not JSON, or null', () => {
    expect(pluginRepository(plugin(undefined))).toBeUndefined()
    expect(pluginRepository(plugin('{'))).toBeUndefined()
    expect(pluginRepository(plugin('null'))).toBeUndefined()
  })
})

describe('skillUrl', () => {
  it('points at the skill directory of the file, and invents nothing without a repository', () => {
    expect(skillUrl('https://github.com/o/r', '/cache/p/skills/locks/SKILL.md')).toBe(
      'https://github.com/o/r/blob/HEAD/skills/locks/SKILL.md',
    )
    expect(skillUrl(undefined, '/cache/p/skills/locks/SKILL.md')).toBeUndefined()
  })
})

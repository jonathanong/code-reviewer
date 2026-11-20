import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findPluginRoot, pluginRoot } from './plugin-root.mts'

describe('findPluginRoot', () => {
  const at = (root: string) => (path: string) => path === join(root, '.claude-plugin/plugin.json')

  it('walks up from a file to the directory holding the manifest', () => {
    expect(findPluginRoot(['/p/cache/v1/bin/code-reviewer'], at('/p/cache/v1'))).toBe('/p/cache/v1')
  })

  it('tries the next start when the first has no manifest above it', () => {
    expect(findPluginRoot(['/$bunfs/root/cli', '/p/v1/bin/cli'], at('/p/v1'))).toBe('/p/v1')
  })

  it('finds nothing when no start is inside a plugin', () => {
    expect(findPluginRoot(['/a/b'], () => false)).toBeUndefined()
  })
})

describe('pluginRoot', () => {
  it('finds this repository from the module location', () => {
    expect(existsSync(join(pluginRoot(), 'skills/review/references'))).toBe(true)
  })

  it('names the manifest and the places it looked when there is none', () => {
    expect(() => pluginRoot(['/nowhere/bin/cli'])).toThrow(
      'no .claude-plugin/plugin.json above /nowhere/bin/cli',
    )
  })
})

import { describe, expect, it } from 'vitest'

import {
  RULE_PLUGINS,
  checkPlugins,
  parsePluginInstalls,
  parsePluginList,
  pluginLabels,
  pluginSettings,
} from './plugins.mts'

const LIST = JSON.stringify([
  { id: 'rules@m', version: '1.0.0', scope: 'user', enabled: true },
  { id: 'off@m', version: '1.0.0', scope: 'user', enabled: false },
  { id: 'db@v', version: '0.11.0', scope: 'user', enabled: true },
  { id: 'db@v', version: '0.4.0', scope: 'project', enabled: true, projectPath: '/here' },
  { id: 'db@v', version: '0.1.0', scope: 'project', enabled: true, projectPath: '/elsewhere' },
  { id: 'bare@v', enabled: true },
  { version: '1.0.0', enabled: true },
  null,
])

describe('parsePluginList', () => {
  it('keeps enabled user plugins and this project’s entries, sorted', () => {
    expect(parsePluginList(LIST, '/here')).toEqual([
      { id: 'bare@v', version: 'unknown' },
      { id: 'db@v', version: '0.4.0' },
      { id: 'rules@m', version: '1.0.0' },
    ])
    expect(parsePluginList(LIST, '/other').find((plugin) => plugin.id === 'db@v')).toEqual({
      id: 'db@v',
      version: '0.11.0',
    })
  })

  it('rejects output that is not a list', () => {
    expect(() => parsePluginList('{}', '/here')).toThrow('did not print an array')
  })
})

describe('checkPlugins', () => {
  it('reports required plugin names that are not enabled', () => {
    const plugins = parsePluginList(LIST, '/other')
    expect(pluginLabels(plugins)).toEqual(['bare@v unknown', 'db@v 0.11.0', 'rules@m 1.0.0'])
    expect(checkPlugins(plugins, ['rules', 'db', 'gone'])).toEqual({
      plugins: ['bare@v unknown', 'db@v 0.11.0', 'rules@m 1.0.0'],
      missing: ['gone'],
    })
  })
})

describe('pluginSettings', () => {
  const plugins = [
    { id: 'no-mistakes-rules@no-mistakes', version: '1' },
    { id: 'skills@jonathanong-skills', version: '1' },
    { id: 'skills-extra@m', version: '1' },
    { id: 'superpowers@official', version: '1' },
  ]

  it('keeps only the rule plugins on', () => {
    expect(RULE_PLUGINS).toEqual(['no-mistakes-rules', 'skills'])
    expect(pluginSettings(plugins)).toEqual({
      enabledPlugins: {
        'no-mistakes-rules@no-mistakes': true,
        'skills@jonathanong-skills': true,
        'skills-extra@m': false,
        'superpowers@official': false,
      },
    })
  })

  it('switches every plugin off for a control run', () => {
    const { enabledPlugins } = pluginSettings(plugins, false)
    expect(Object.keys(enabledPlugins)).toHaveLength(4)
    expect(Object.values(enabledPlugins).every((on) => !on)).toBe(true)
  })

  it('is empty when no plugin is enabled', () => {
    expect(pluginSettings([])).toEqual({ enabledPlugins: {} })
  })
})

describe('parsePluginInstalls', () => {
  it('keeps enabled user-scope plugins that have an install path', () => {
    const listed = JSON.stringify([
      { id: 'skills@m', scope: 'user', enabled: true, installPath: '/cache/skills' },
      { id: 'off@m', scope: 'user', enabled: false, installPath: '/cache/off' },
      { id: 'proj@m', scope: 'project', enabled: true, installPath: '/cache/proj' },
      { id: 'bare@m', scope: 'user', enabled: true },
      { scope: 'user', enabled: true, installPath: '/x' },
      null,
    ])
    expect(parsePluginInstalls(listed)).toEqual([{ name: 'skills', installPath: '/cache/skills' }])
  })

  it('rejects output that is not a list', () => {
    expect(() => parsePluginInstalls('{}')).toThrow('did not print an array')
  })
})

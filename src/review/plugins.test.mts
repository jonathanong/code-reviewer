import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RULE_PLUGINS,
  checkPlugins,
  parsePluginInstalls,
  parsePluginList,
  pluginLabels,
  pluginSettings,
  unloadableMessage,
  unloadableRulePlugins,
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
    { id: 'ratchet-workflows@ratchet-stack', version: '1' },
    { id: 'skills-extra@m', version: '1' },
    { id: 'superpowers@official', version: '1' },
  ]

  it('keeps only the rule plugins on', () => {
    expect(DEFAULT_RULE_PLUGINS).toEqual([
      'no-mistakes-rules',
      'ratchet-workflows',
      'ratchet-github',
      'ratchet-backend',
      'ratchet-code',
    ])
    expect(pluginSettings(plugins, DEFAULT_RULE_PLUGINS)).toEqual({
      enabledPlugins: {
        'no-mistakes-rules@no-mistakes': true,
        'ratchet-workflows@ratchet-stack': true,
        'skills-extra@m': false,
        'superpowers@official': false,
      },
    })
  })

  it('switches every plugin off for a control run', () => {
    const { enabledPlugins } = pluginSettings(plugins, DEFAULT_RULE_PLUGINS, false)
    expect(Object.keys(enabledPlugins)).toHaveLength(4)
    expect(Object.values(enabledPlugins).every((on) => !on)).toBe(true)
  })

  it('is empty when no plugin is enabled', () => {
    expect(pluginSettings([], DEFAULT_RULE_PLUGINS)).toEqual({ enabledPlugins: {} })
  })

  it('turns on exactly the configured plugins, and none for an empty list', () => {
    expect(pluginSettings(plugins, ['superpowers']).enabledPlugins).toEqual({
      'no-mistakes-rules@no-mistakes': false,
      'ratchet-workflows@ratchet-stack': false,
      'skills-extra@m': false,
      'superpowers@official': true,
    })
    expect(Object.values(pluginSettings(plugins, []).enabledPlugins)).toEqual([
      false,
      false,
      false,
      false,
    ])
  })
})

describe('parsePluginInstalls', () => {
  it('keeps enabled user-scope plugins that have an install path', () => {
    const listed = JSON.stringify([
      { id: 'ratchet-workflows@m', scope: 'user', enabled: true, installPath: '/cache/skills' },
      { id: 'off@m', scope: 'user', enabled: false, installPath: '/cache/off' },
      { id: 'proj@m', scope: 'project', enabled: true, installPath: '/cache/proj' },
      { id: 'bare@m', scope: 'user', enabled: true },
      { id: 'local', scope: 'user', enabled: true, installPath: '/cache/local' },
      { scope: 'user', enabled: true, installPath: '/x' },
      null,
    ])
    expect(parsePluginInstalls(listed)).toEqual([
      { name: 'ratchet-workflows', installPath: '/cache/skills', marketplace: 'm' },
      { name: 'local', installPath: '/cache/local' },
    ])
  })

  it('rejects output that is not a list', () => {
    expect(() => parsePluginInstalls('{}')).toThrow('did not print an array')
  })
})

describe('unloadableRulePlugins', () => {
  const installs = [{ name: 'a', installPath: '/a' }]

  it('names the configured plugins without a user-scope install, in list order', () => {
    expect(unloadableRulePlugins(installs, ['z', 'a', 'y'])).toEqual(['z', 'y'])
    expect(unloadableRulePlugins(installs, ['a'])).toEqual([])
    expect(unloadableRulePlugins([], [])).toEqual([])
  })

  it('words the failure with every name', () => {
    expect(unloadableMessage(['z', 'y'])).toBe(
      'rule plugins missing or not enabled at user scope: z, y',
    )
  })
})

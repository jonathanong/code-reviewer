import { describe, expect, it } from 'vitest'

import { checkPlugins, parsePluginList, pluginLabels } from './plugins.mts'

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

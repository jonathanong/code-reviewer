import { describe, expect, it, vi } from 'vitest'

import { benchPlugins } from './plugin-settings.mts'

const LISTED = JSON.stringify([
  { id: 'jong-skills@m', version: '1.0.0', enabled: true },
  { id: 'other@m', version: '2.0.0', enabled: true },
])

describe('benchPlugins', () => {
  it('records the enabled plugins and keeps only the rule plugins on', async () => {
    const result = await benchPlugins(async () => LISTED, '/cwd', true, vi.fn())
    expect(result.labels).toEqual(['jong-skills@m 1.0.0', 'other@m 2.0.0'])
    expect(result.settings).toEqual({ enabledPlugins: { 'other@m': false, 'jong-skills@m': true } })
  })

  it('lists where the enabled user-scope plugins are installed', async () => {
    const stdout = JSON.stringify([
      { id: 'jong-skills@m', enabled: true, scope: 'user', installPath: '/p/jong' },
    ])
    const result = await benchPlugins(async () => stdout, '/cwd', true, vi.fn())
    expect(result.installs).toEqual([{ name: 'jong-skills', installPath: '/p/jong' }])
  })

  it('records none and switches everything off for a control run', async () => {
    const result = await benchPlugins(async () => LISTED, '/cwd', false, vi.fn())
    expect(result.labels).toEqual([])
    expect(result.settings).toEqual({
      enabledPlugins: { 'other@m': false, 'jong-skills@m': false },
    })
  })

  it('logs and returns no settings when plugins cannot be listed', async () => {
    const log = vi.fn()
    const failing = async () => {
      throw new Error('no claude')
    }
    expect(await benchPlugins(failing, '/cwd', true, log)).toEqual({
      labels: ['unknown'],
      settings: undefined,
      noPlugins: undefined,
      installs: [],
    })
    expect(await benchPlugins(async () => '{}', '/cwd', false, log)).toEqual({
      labels: [],
      settings: undefined,
      noPlugins: undefined,
      installs: [],
    })
    expect(log).toHaveBeenCalledWith('plugins: no claude')
    expect(log).toHaveBeenCalledWith('plugins: claude plugin list did not print an array.')
  })

  it('logs a thrown non-error value', async () => {
    const log = vi.fn()
    await benchPlugins(
      async () => {
        throw 'plain'
      },
      '/cwd',
      true,
      log,
    )
    expect(log).toHaveBeenCalledWith('plugins: plain')
  })
})

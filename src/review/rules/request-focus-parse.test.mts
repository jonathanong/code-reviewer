import { describe, expect, it } from 'vitest'

import { requireValidConfig } from '../../cli/config-check.mts'
import { resolveRequestFocus } from '../settings.mts'
import { parseRepoConfig, type RepoConfigs } from './config.mts'

const FILE = 'acme/web.json'

describe('parseRepoConfig requestFocus', () => {
  it('reads the switch from a repository file and an owner file', () => {
    expect(parseRepoConfig('{"requestFocus":{"enabled":true}}', FILE).requestFocus).toEqual({
      enabled: true,
    })
    expect(
      parseRepoConfig('{"requestFocus":{"enabled":false}}', 'acme.json', 'owner').requestFocus,
    ).toEqual({
      enabled: false,
    })
  })

  it.each([
    ['not an object', '"yes"', 'must be an object'],
    ['an array', '[]', 'must be an object'],
    ['no switch', '{}', 'enabled: is required'],
    ['a switch that is not a boolean', '{"enabled":"yes"}', 'must be true or false'],
    ['an unknown key', '{"enabled":true,"max":1}', 'unknown key "max"'],
  ])('ignores %s with a problem naming the file and key', (_name, value, reason) => {
    const parsed = parseRepoConfig(`{"requestFocus":${value}}`, FILE)
    expect(parsed.requestFocus).toBeUndefined()
    expect(parsed.problems).toEqual([expect.stringContaining(`${FILE} requestFocus`)])
    expect(parsed.problems.join()).toContain(reason)
  })

  it('ignores it in the reviewed repository own file and says it is machine-only', () => {
    const file = 'acme/web/.code-reviewer.json'
    expect(parseRepoConfig('{"requestFocus":{"enabled":true}}', file, 'target')).toEqual({
      consumes: [],
      problems: [`${file}: requestFocus is machine-only; ignored`],
    })
  })

  it('stops a command before any work when the value is malformed', async () => {
    const parsed = parseRepoConfig('{"requestFocus":{"enabled":"yes"}}', FILE)
    const configs: RepoConfigs = {
      byRepo: new Map([['acme/web', parsed]]),
      byOwner: new Map(),
      problems: parsed.problems,
    }
    const deps = { configs: () => configs, targetConfig: async () => ({ problems: [] }) }
    await expect(requireValidConfig(deps as never, 'acme/web')).rejects.toThrow(
      /acme\/web\.json requestFocus/u,
    )
  })
})

describe('resolveRequestFocus', () => {
  const configs: RepoConfigs = {
    byOwner: new Map([['acme', { consumes: [], requestFocus: { enabled: true }, problems: [] }]]),
    byRepo: new Map([
      ['acme/off', { consumes: [], requestFocus: { enabled: false }, problems: [] }],
      ['acme/plain', { consumes: [], problems: [] }],
    ]),
    problems: [],
  }

  it('is off until a machine layer sets it', () => {
    expect(
      resolveRequestFocus({ byRepo: new Map(), byOwner: new Map(), problems: [] }, 'acme/web'),
    ).toEqual({ enabled: false, from: null })
  })

  it('takes the repository value over the owner value', () => {
    expect(resolveRequestFocus(configs, 'acme/off')).toEqual({
      enabled: false,
      from: 'machine repo',
    })
    expect(resolveRequestFocus(configs, 'acme/plain')).toEqual({
      enabled: true,
      from: 'machine owner',
    })
  })
})

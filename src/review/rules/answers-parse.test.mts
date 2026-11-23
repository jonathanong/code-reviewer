import { describe, expect, it } from 'vitest'

import { requireValidConfig } from '../../cli/config-check.mts'
import { resolveAnswers } from '../settings.mts'
import { parseRepoConfig, type RepoConfigs } from './config.mts'

const FILE = 'acme/web.json'

describe('parseRepoConfig answers', () => {
  it('reads the switch from a repository file and an owner file', () => {
    expect(parseRepoConfig('{"answers":{"enabled":true}}', FILE).answers).toEqual({
      enabled: true,
    })
    expect(parseRepoConfig('{"answers":{"enabled":false}}', 'acme.json', 'owner').answers).toEqual({
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
    const parsed = parseRepoConfig(`{"answers":${value}}`, FILE)
    expect(parsed.answers).toBeUndefined()
    expect(parsed.problems).toEqual([expect.stringContaining(`${FILE} answers`)])
    expect(parsed.problems.join()).toContain(reason)
  })

  it('ignores it in the reviewed repository own file and says it is machine-only', () => {
    const file = 'acme/web/.code-reviewer.json'
    expect(parseRepoConfig('{"answers":{"enabled":true}}', file, 'target')).toEqual({
      consumes: [],
      problems: [`${file}: answers is machine-only; ignored`],
    })
  })

  it('stops a command before any work when the value is malformed', async () => {
    const parsed = parseRepoConfig('{"answers":{"enabled":"yes"}}', FILE)
    const configs: RepoConfigs = {
      byRepo: new Map([['acme/web', parsed]]),
      byOwner: new Map(),
      problems: parsed.problems,
    }
    const deps = { configs: () => configs, targetConfig: async () => ({ problems: [] }) }
    await expect(requireValidConfig(deps as never, 'acme/web')).rejects.toThrow(
      /acme\/web\.json answers/u,
    )
  })
})

describe('resolveAnswers', () => {
  const configs: RepoConfigs = {
    byOwner: new Map([['acme', { consumes: [], answers: { enabled: true }, problems: [] }]]),
    byRepo: new Map([
      ['acme/off', { consumes: [], answers: { enabled: false }, problems: [] }],
      ['acme/plain', { consumes: [], problems: [] }],
    ]),
    problems: [],
  }

  it('is off until a machine layer sets it', () => {
    expect(
      resolveAnswers({ byRepo: new Map(), byOwner: new Map(), problems: [] }, 'acme/web'),
    ).toEqual({ enabled: false, from: null })
  })

  it('takes the repository value over the owner value', () => {
    expect(resolveAnswers(configs, 'acme/off')).toEqual({ enabled: false, from: 'machine repo' })
    expect(resolveAnswers(configs, 'acme/plain')).toEqual({
      enabled: true,
      from: 'machine owner',
    })
  })
})

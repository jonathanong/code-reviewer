import { describe, expect, it } from 'vitest'

import { parseRepoConfig } from './config.mts'
import { parseLimits } from './limits-parse.mts'

const WHERE = 'acme/widgets.yaml limits'

function parse(raw: unknown) {
  const problems: string[] = []
  return { config: parseLimits(raw, WHERE, problems), problems }
}

describe('parseLimits', () => {
  it('reads a ceiling and treats an absent key or an empty object as no ceiling', () => {
    expect(parse({ maxCostUsd: 2.5 })).toEqual({ config: { maxCostUsd: 2.5 }, problems: [] })
    expect(parse(undefined)).toEqual({ config: undefined, problems: [] })
    expect(parse({})).toEqual({ config: {}, problems: [] })
  })

  it.each([
    ['zero', { maxCostUsd: 0 }],
    ['negative', { maxCostUsd: -1 }],
    ['a string', { maxCostUsd: '5' }],
    ['not finite', { maxCostUsd: Number.POSITIVE_INFINITY }],
    ['null', { maxCostUsd: null }],
  ])('ignores the key whole when the ceiling is %s', (_name, raw) => {
    const { config, problems } = parse(raw)
    expect(config).toBeUndefined()
    expect(problems).toEqual([
      `${WHERE}.maxCostUsd: must be a number greater than 0; limits ignored`,
    ])
  })

  it('ignores the key whole for an unknown key or a value that is not an object', () => {
    expect(parse({ maxCostUsd: 1, nope: 1 })).toEqual({
      config: undefined,
      problems: [`${WHERE}: unknown key "nope" ignored; limits ignored`],
    })
    expect(parse(['x'])).toEqual({
      config: undefined,
      problems: [`${WHERE}: must be an object; ignored`],
    })
  })
})

describe('limits in a config file', () => {
  const text = '{"limits":{"maxCostUsd":3}}'

  it('is read from a machine repo file and a machine owner file', () => {
    expect(parseRepoConfig(text, 'acme/widgets.json', 'repo')).toMatchObject({
      limits: { maxCostUsd: 3 },
      problems: [],
    })
    expect(parseRepoConfig(text, 'acme.json', 'owner')).toMatchObject({
      limits: { maxCostUsd: 3 },
      problems: [],
    })
  })

  it("is ignored, with a problem naming the file, in the reviewed repository's own file", () => {
    const config = parseRepoConfig(text, 'acme/widgets/.code-reviewer.json', 'target')
    expect(config.limits).toBeUndefined()
    expect(config.problems).toEqual([
      'acme/widgets/.code-reviewer.json: limits is machine-only; ignored',
    ])
  })

  it('names the file and key of a bad value', () => {
    const config = parseRepoConfig('{"limits":{"maxCostUsd":0}}', 'acme/widgets.json', 'repo')
    expect(config.limits).toBeUndefined()
    expect(config.problems).toEqual([
      'acme/widgets.json limits.maxCostUsd: must be a number greater than 0; limits ignored',
    ])
  })
})

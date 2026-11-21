import { describe, expect, it } from 'vitest'

import { parseModels } from './models-parse.mts'

const WHERE = 'acme/widgets.yaml models'
const claude = (model: string) => ({ harness: 'claude', model })

function parse(raw: unknown) {
  const problems: string[] = []
  return { config: parseModels(raw, WHERE, problems), problems }
}

describe('parseModels', () => {
  it('reads tiers, steps and the wait budget', () => {
    const { config, problems } = parse({
      tiers: { small: [claude('a')], large: [claude('b'), claude('c')] },
      steps: { select: 'small', 'pillar.history': 'small', verifier: [claude('d')] },
      retry: { maxWaitSeconds: 0 },
    })
    expect(problems).toEqual([])
    expect(config).toEqual({
      tiers: { small: [claude('a')], large: [claude('b'), claude('c')] },
      steps: { select: 'small', 'pillar.history': 'small', verifier: [claude('d')] },
      retry: { maxWaitSeconds: 0 },
    })
  })

  it('accepts a step for a configured pillar, which falls back like a built-in one', () => {
    const { config, problems } = parse({ steps: { 'pillar.a11y': 'large', pillars: 'small' } })
    expect(problems).toEqual([])
    expect(config?.steps).toEqual({ 'pillar.a11y': 'large', pillars: 'small' })
    expect(parse({ steps: { 'pillar.A11y': 'large' } }).problems.join()).toContain(
      'unknown key "pillar.A11y"',
    )
  })

  it('accepts grok and opencode on steps they can run', () => {
    const steps = {
      select: [{ harness: 'grok', model: 'g' }],
      verifier: [{ harness: 'opencode', model: 'a/b' }],
    }
    expect(parse({ steps })).toEqual({ config: { steps }, problems: [] })
  })

  it('ignores the whole key for a free verifier model or a history step no candidate can run', () => {
    const free = parse({ steps: { approvalCheck: [{ harness: 'opencode', model: 'x/y-free' }] } })
    expect(free.config).toBeUndefined()
    expect(free.problems).toEqual([
      `${WHERE}: step "approvalCheck" cannot use the free model "x/y-free"; models ignored`,
    ])
    const history = parse({ steps: { 'pillar.history': [{ harness: 'grok', model: 'g' }] } })
    expect(history.config).toBeUndefined()
    expect(history.problems[0]).toContain(`${WHERE}: step "pillar.history" has no candidate`)
  })

  it('treats an absent key as unset and an empty object as no change', () => {
    expect(parse(undefined)).toEqual({ config: undefined, problems: [] })
    expect(parse({})).toEqual({ config: {}, problems: [] })
  })

  it.each([
    ['not an object', 'x', `${WHERE}: must be an object; ignored`],
    ['an unknown key', { nope: 1 }, `${WHERE}: unknown key "nope" ignored; models ignored`],
    ['tiers not an object', { tiers: [] }, `${WHERE}.tiers: must be an object; models ignored`],
    ['an unknown tier', { tiers: { huge: [claude('a')] } }, 'unknown key "huge"'],
    [
      'an empty tier list',
      { tiers: { small: [] } },
      `${WHERE}.tiers.small: must be a non-empty list`,
    ],
    ['steps not an object', { steps: 3 }, `${WHERE}.steps: must be an object`],
    ['an unknown step', { steps: { review: 'small' } }, 'unknown key "review"'],
    [
      'an unknown tier name',
      { steps: { select: 'tiny' } },
      `${WHERE}.steps.select: unknown tier "tiny"`,
    ],
    [
      'an empty step list',
      { steps: { select: [] } },
      `${WHERE}.steps.select: must be a non-empty list`,
    ],
    [
      'a step value of another type',
      { steps: { select: 3 } },
      `${WHERE}.steps.select: must be a non-empty list`,
    ],
    [
      'an entry that is not an object',
      { tiers: { small: ['claude'] } },
      `${WHERE}.tiers.small[0]: must be an object`,
    ],
    [
      'an unknown harness',
      { tiers: { small: [{ harness: 'nope', model: 'a' }] } },
      `${WHERE}.tiers.small[0]: "harness" must be one of claude, grok, opencode`,
    ],
    [
      'a missing harness',
      { tiers: { small: [{ model: 'a' }] } },
      '"harness" must be one of claude',
    ],
    [
      'a blank model',
      { tiers: { small: [{ harness: 'claude', model: ' ' }] } },
      '"model" must be a non-empty string',
    ],
    [
      'an unknown entry key',
      { tiers: { small: [{ harness: 'claude', model: 'a', x: 1 }] } },
      'unknown key "x"',
    ],
    ['retry not an object', { retry: 5 }, `${WHERE}.retry: must be an object`],
    [
      'a negative wait',
      { retry: { maxWaitSeconds: -1 } },
      'maxWaitSeconds: must be a whole number',
    ],
    [
      'a fractional wait',
      { retry: { maxWaitSeconds: 1.5 } },
      'maxWaitSeconds: must be a whole number',
    ],
    ['an unknown retry key', { retry: { maxWaitSeconds: 1, jitter: 1 } }, 'unknown key "jitter"'],
  ])('ignores the whole key for %s', (_name, raw, expected) => {
    const { config, problems } = parse(raw)
    expect(config).toBeUndefined()
    expect(problems.some((problem) => problem.includes(expected))).toBe(true)
    expect(problems.every((problem) => problem.startsWith('acme/widgets.yaml models'))).toBe(true)
    expect(problems.every((problem) => problem.endsWith('ignored'))).toBe(true)
  })

  it('keeps a good key out of the result when another key is bad', () => {
    const { config, problems } = parse({ steps: { select: 'small' }, tiers: { small: [] } })
    expect(config).toBeUndefined()
    expect(problems).toHaveLength(1)
  })
})

import { describe, expect, it } from 'vitest'

import { parseRepoConfig } from './config.mts'
import { parsePillars } from './pillars-parse.mts'

function parse(raw: unknown) {
  const problems: string[] = []
  return { value: parsePillars(raw, 'f pillars', problems), problems }
}

const extra = (overrides: Record<string, unknown> = {}) => ({
  name: 'accessibility',
  prompt: 'Look for missing labels.',
  ...overrides,
})

describe('parsePillars', () => {
  it('is absent when the key is absent', () => {
    expect(parse(undefined)).toEqual({ value: undefined, problems: [] })
  })

  it('reads disabled built-ins and extras, defaulting modes to full', () => {
    const { value, problems } = parse({
      disabled: ['history', 'design'],
      extra: [
        extra({ when: ' the change touches UI ', prompt: '  Be brief.\n' }),
        { name: 'native', run: ' /code-review low ', modes: ['light', 'full'] },
      ],
    })
    expect(problems).toEqual([])
    expect(value).toEqual({
      disabled: ['history', 'design'],
      extra: [
        {
          name: 'accessibility',
          modes: ['full'],
          when: 'the change touches UI',
          source: { prompt: 'Be brief.' },
        },
        { name: 'native', modes: ['light', 'full'], source: { run: '/code-review low' } },
      ],
    })
  })

  it('accepts an empty key and either part alone', () => {
    expect(parse({}).value).toEqual({})
    expect(parse({ disabled: [] }).value).toEqual({ disabled: [] })
    expect(parse({ extra: [] }).value).toEqual({ extra: [] })
  })

  const invalid: [string, unknown, string][] = [
    ['a string', 'x', 'f pillars: must be an object; ignored'],
    ['an array', [], 'f pillars: must be an object; ignored'],
    ['an unknown key', { disable: [] }, 'f pillars: unknown key "disable" ignored'],
    ['a non-array disabled', { disabled: 'history' }, 'f pillars.disabled: must be an array'],
    ['an unknown built-in', { disabled: ['nope'] }, 'unknown built-in pillar "nope"'],
    ['congruence, which is never dispatched', { disabled: ['congruence'] }, '"congruence"'],
    ['a repeated built-in', { disabled: ['rules', 'rules'] }, '"rules" is listed more than once'],
    ['a non-array extra', { extra: {} }, 'f pillars.extra: must be an array'],
    ['a non-object entry', { extra: ['x'] }, 'f pillars.extra[0]: must be an object'],
    ['an unknown entry key', { extra: [extra({ tools: ['Bash'] })] }, 'unknown key "tools"'],
    ['no name', { extra: [{ prompt: 'x' }] }, 'extra[0].name: must match'],
    ['a bad name', { extra: [extra({ name: 'Bad_Name' })] }, 'extra[0].name: must match'],
    ['a built-in name', { extra: [extra({ name: 'history' })] }, 'is a built-in pillar'],
    [
      'a repeated name',
      { extra: [extra(), extra({ prompt: 'y' })] },
      'extra[1].name: "accessibility" is used more than once',
    ],
    ['neither prompt nor run', { extra: [{ name: 'a' }] }, 'set exactly one of "prompt" and "run"'],
    [
      'both prompt and run',
      { extra: [extra({ run: '/x' })] },
      'set exactly one of "prompt" and "run"',
    ],
    [
      'an empty prompt',
      { extra: [extra({ prompt: '  ' })] },
      'extra[0].prompt: must be a non-empty',
    ],
    ['a non-string run', { extra: [{ name: 'a', run: 3 }] }, 'extra[0].run: must be a non-empty'],
    ['an empty when', { extra: [extra({ when: '' })] }, 'extra[0].when: must be a non-empty'],
    [
      'when with run',
      { extra: [{ name: 'a', run: '/x', when: 'y' }] },
      'extra[0].when: only works with "prompt"',
    ],
    [
      'an empty modes list',
      { extra: [extra({ modes: [] })] },
      'extra[0].modes: must be a non-empty',
    ],
    [
      'a non-array modes',
      { extra: [extra({ modes: 'full' })] },
      'extra[0].modes: must be a non-empty',
    ],
    ['an unknown mode', { extra: [extra({ modes: ['skip'] })] }, 'unknown mode "skip"'],
    [
      'a repeated mode',
      { extra: [extra({ modes: ['full', 'full'] })] },
      '"full" is listed more than once',
    ],
  ]
  it.each(invalid)('ignores the whole key for %s, naming file and key', (_name, raw, expected) => {
    const { value, problems } = parse(raw)
    expect(value).toBeUndefined()
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toContain(expected)
    expect(problems.every((problem) => problem.startsWith('f pillars'))).toBe(true)
  })

  it('keeps one valid extra from hiding the problem of another', () => {
    const { value, problems } = parse({ extra: [extra(), extra({ name: 'Bad' })] })
    expect(value).toBeUndefined()
    expect(problems).toHaveLength(1)
  })
})

describe('the pillars key in a config file', () => {
  const text = JSON.stringify({ pillars: { disabled: ['history'], extra: [extra()] } })

  it.each(['repo', 'owner', 'target'] as const)('is read in a %s file', (scope) => {
    const config = parseRepoConfig(text, 'f.json', scope)
    expect(config.problems).toEqual([])
    expect(config.pillars?.disabled).toEqual(['history'])
    expect(config.pillars?.extra?.[0]?.name).toBe('accessibility')
  })

  it('reports a bad key against the file and drops it', () => {
    const config = parseRepoConfig(
      '{"pillars":{"disabled":["x"]}}',
      'o/r/.code-reviewer.json',
      'target',
    )
    expect(config.pillars).toBeUndefined()
    expect(config.problems[0]).toContain('o/r/.code-reviewer.json pillars.disabled')
  })
})

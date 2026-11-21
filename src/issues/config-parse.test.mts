import { describe, expect, it } from 'vitest'

import { parseRepoConfig } from '../review/rules/config.mts'
import { DEFAULT_MAX_ISSUES_PER_DAY, parseIssues } from './config-parse.mts'

const WHERE = 'acme.yaml issues'
const target = { name: 'rules-plugin', repo: 'acme/rules' }

function parse(raw: unknown) {
  const problems: string[] = []
  return { value: parseIssues(raw, WHERE, problems), problems }
}

describe('parseIssues', () => {
  it('is absent when the key is absent', () => {
    expect(parse(undefined)).toEqual({ value: undefined, problems: [] })
  })

  it('defaults maxPerDay and labels', () => {
    expect(parse({ targets: [target] })).toEqual({
      value: {
        maxPerDay: DEFAULT_MAX_ISSUES_PER_DAY,
        targets: [{ ...target, labels: [] }],
      },
      problems: [],
    })
  })

  it('reads maxPerDay, labels and several targets', () => {
    const value = {
      maxPerDay: 5,
      targets: [
        { ...target, labels: [' bot '] },
        { name: 'code-reviewer', repo: 'acme/reviewer' },
      ],
    }
    expect(parse(value).value).toEqual({
      maxPerDay: 5,
      targets: [
        { ...target, labels: ['bot'] },
        { name: 'code-reviewer', repo: 'acme/reviewer', labels: [] },
      ],
    })
  })

  it('accepts an empty target list, which files nothing', () => {
    expect(parse({ targets: [] }).value).toEqual({
      maxPerDay: DEFAULT_MAX_ISSUES_PER_DAY,
      targets: [],
    })
  })

  it.each([
    ['a non-object', 'yes', `${WHERE}: must be an object; ignored`],
    ['an array', [], `${WHERE}: must be an object; ignored`],
    [
      'an unknown key',
      { targets: [], extra: 1 },
      `${WHERE}: unknown key "extra" ignored; issues ignored`,
    ],
    ['missing targets', {}, `${WHERE}.targets: must be a list; issues ignored`],
    [
      'targets that is not a list',
      { targets: target },
      `${WHERE}.targets: must be a list; issues ignored`,
    ],
    [
      'a zero maxPerDay',
      { maxPerDay: 0, targets: [] },
      `${WHERE}.maxPerDay: must be an integer of at least 1; issues ignored`,
    ],
    [
      'a fractional maxPerDay',
      { maxPerDay: 1.5, targets: [] },
      `${WHERE}.maxPerDay: must be an integer of at least 1; issues ignored`,
    ],
    [
      'a string maxPerDay',
      { maxPerDay: '3', targets: [] },
      `${WHERE}.maxPerDay: must be an integer of at least 1; issues ignored`,
    ],
    [
      'a target that is not an object',
      { targets: ['x'] },
      `${WHERE}.targets[0]: must be an object; issues ignored`,
    ],
    [
      'a blank name',
      { targets: [{ ...target, name: ' ' }] },
      `${WHERE}.targets[0].name: must be a non-empty string; issues ignored`,
    ],
    [
      'a missing name',
      { targets: [{ repo: 'acme/rules' }] },
      `${WHERE}.targets[0].name: must be a non-empty string; issues ignored`,
    ],
    [
      'a repo that is not owner/name',
      { targets: [{ ...target, repo: 'rules' }] },
      `${WHERE}.targets[0].repo: must be owner/name; issues ignored`,
    ],
    [
      'a missing repo',
      { targets: [{ name: 'x' }] },
      `${WHERE}.targets[0].repo: must be owner/name; issues ignored`,
    ],
    [
      'labels that is not a list',
      { targets: [{ ...target, labels: 'bot' }] },
      `${WHERE}.targets[0].labels: must be a list of non-empty strings; issues ignored`,
    ],
    [
      'a blank label',
      { targets: [{ ...target, labels: [''] }] },
      `${WHERE}.targets[0].labels: must be a list of non-empty strings; issues ignored`,
    ],
    [
      'an unknown target key',
      { targets: [{ ...target, color: 'red' }] },
      `${WHERE}.targets[0]: unknown key "color" ignored; issues ignored`,
    ],
    [
      'a repeated name',
      { targets: [target, { ...target, repo: 'acme/other' }] },
      `${WHERE}.targets: name "rules-plugin" is listed more than once; issues ignored`,
    ],
  ])('ignores the whole key for %s', (_, raw, problem) => {
    expect(parse(raw)).toEqual({ value: undefined, problems: [problem] })
  })
})

describe('issues in a config file', () => {
  const text = JSON.stringify({ issues: { targets: [target] } })

  it('is read from a machine file', () => {
    expect(parseRepoConfig(text, 'acme.json', 'owner').issues?.targets).toEqual([
      { ...target, labels: [] },
    ])
  })

  it('is ignored in the reviewed repository own file, with a problem', () => {
    const config = parseRepoConfig(text, 'acme/widgets/.code-reviewer.json', 'target')
    expect(config.issues).toBeUndefined()
    expect(config.problems).toEqual([
      'acme/widgets/.code-reviewer.json: issues is machine-only; ignored',
    ])
  })
})

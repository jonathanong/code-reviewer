import { describe, expect, it } from 'vitest'

import { classLine, scopeLabel } from './class-line.mts'

describe('scopeLabel', () => {
  it('says nothing for a pull request with no files', () => {
    expect(scopeLabel([])).toBeUndefined()
  })

  it('says test-only when every changed file is a test file, fixtures and snapshots included', () => {
    expect(
      scopeLabel([
        'src/a.test.mts',
        'src/fixtures/input.json',
        'tests/__snapshots__/a.snap',
        'pkg/b_test.go',
      ]),
    ).toBe('test-only')
  })

  it('lists the kinds, most files first, when a test change also touches one source file', () => {
    expect(scopeLabel(['src/a.test.mts', 'src/b.test.mts', 'src/a.mts'])).toBe('tests, source')
    expect(scopeLabel(['src/a.test.mts', 'src/a.mts'])).toBe('source, tests')
  })

  it.each([
    [['README.md', 'docs/a.md'], 'docs-only'],
    [
      ['AGENTS.md', 'skills/x/SKILL.md', 'skills/x/references/y.md', 'evals/a/cases.json'],
      'agent-direction-only',
    ],
    [['package.json', 'pnpm-lock.yaml'], 'dependencies-only'],
    [['dist/a.js', 'src/types.generated.ts'], 'generated-paths-only'],
    [['.github/workflows/ci.yml', '.github/actions/x/action.yml'], 'ci-only'],
    [['tsconfig.json', '.oxlintrc.json'], 'config-only'],
  ])('says %j is %s', (paths, label) => {
    expect(scopeLabel(paths)).toBe(label)
  })

  it('keeps a skill or agent file out of docs and tests', () => {
    expect(scopeLabel(['skills/review/SKILL.md', 'evals/x/tests/a.test.mts'])).toBe(
      'agent-direction-only',
    )
  })

  it('prints a source-only change as plain source', () => {
    expect(scopeLabel(['src/a.mts', 'src/b.mts'])).toBe('source')
  })

  it('caps the list at four kinds, breaking ties in a fixed order', () => {
    expect(
      scopeLabel([
        'a.mts',
        'a.test.mts',
        'a.md',
        'AGENTS.md',
        'package.json',
        '.github/workflows/x.yml',
      ]),
    ).toBe('source, tests, docs, agent direction')
  })
})

describe('classLine', () => {
  it('is empty without an impact and without files', () => {
    expect(classLine([], undefined)).toEqual([])
  })

  it('shows the scope alone when the verifier did not judge the impact', () => {
    expect(classLine(['src/a.test.mts'], undefined)).toEqual(['**Class:** test-only'])
  })

  it('shows the impact alone when there are no files', () => {
    expect(classLine([], { kind: 'unsure', basis: 'needs the consumers list' })).toEqual([
      '**Class:** unsure (needs the consumers list)',
    ])
    expect(classLine([], { kind: 'maintenance' })).toEqual(['**Class:** maintenance'])
  })

  it('joins impact and scope on one line', () => {
    expect(classLine(['pnpm-lock.yaml', 'package.json'], { kind: 'maintenance' })).toEqual([
      '**Class:** maintenance · dependencies-only',
    ])
    expect(
      classLine(['src/a.mts', 'src/a.test.mts', 'src/b.test.mts'], {
        kind: 'breaking',
        basis: 'removes the `--foo` CLI flag',
      }),
    ).toEqual(['**Class:** breaking (removes the `--foo` CLI flag) · tests, source'])
  })
})

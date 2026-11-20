import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  clearDependencies,
  DEPENDENCIES_FILE,
  impliedDependencies,
  mergeDependencies,
  oneLine,
  readDependencies,
  stackDependencies,
  type Dependency,
} from './dependency.mts'
import type { StackFile } from './stack-file.mts'

const dep = (on: string, kind: Dependency['kind'] = 'pull'): Dependency => ({
  on,
  kind,
  state: 'open',
  why: 'w',
})

describe('oneLine', () => {
  it('makes text one bounded line that mentions and quotes nobody', () => {
    expect(oneLine('a `b`\n\tc @octocat', 100)).toBe('a b c @​octocat')
    expect(oneLine('x'.repeat(50), 10)).toHaveLength(10)
  })
})

describe('impliedDependencies', () => {
  it('keeps the named thing, its kind and its reason, and never trusts a claimed state', () => {
    expect(
      impliedDependencies([
        {
          on: 'package @acme/ui ^2.1',
          kind: 'package',
          why: 'The change calls `render`.',
          state: 'merged',
        },
        { on: 'orders service', kind: 'api', why: 'Needs the new /v2 route.' },
      ]),
    ).toEqual([
      {
        on: 'package @​acme/ui ^2.1',
        kind: 'package',
        state: 'unknown',
        why: 'The change calls render.',
      },
      { on: 'orders service', kind: 'api', state: 'unknown', why: 'Needs the new /v2 route.' },
    ])
  })

  it('drops what is malformed instead of failing the review', () => {
    expect(impliedDependencies(undefined)).toEqual([])
    expect(impliedDependencies('x')).toEqual([])
    expect(
      impliedDependencies([
        null,
        7,
        { on: '', kind: 'api', why: 'x' },
        { on: 'a', kind: 'api', why: ' ' },
        { on: 'a', kind: 'pull', why: 'x' },
        { on: 3, kind: 'api', why: 'x' },
        { on: 'a', kind: 'api' },
      ]),
    ).toEqual([])
  })
})

describe('mergeDependencies', () => {
  it('lists what prepare found first, once per name regardless of case, capped', () => {
    expect(mergeDependencies([dep('#1')], [dep('#1', 'api'), dep('Billing', 'service')])).toEqual([
      dep('#1'),
      dep('Billing', 'service'),
    ])
    expect(mergeDependencies([dep('A')], [dep('a')])).toHaveLength(1)
    const many = Array.from({ length: 20 }, (_, at) => dep(`#${at}`))
    expect(mergeDependencies(many, [])).toHaveLength(15)
  })
})

describe('stackDependencies', () => {
  it('names each parent the pull request is stacked on, none for the bottom', () => {
    const member = (number: number) => ({ number })
    const stack = { members: [member(3), member(4), member(5)], index: 2 } as unknown as StackFile
    expect(stackDependencies(stack).map((entry) => [entry.on, entry.kind, entry.state])).toEqual([
      ['#3', 'stack-parent', 'open'],
      ['#4', 'stack-parent', 'open'],
    ])
    expect(stackDependencies({ ...stack, index: 0 } as StackFile)).toEqual([])
  })
})

describe('dependencies.json', () => {
  let out: string
  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'dependency-'))
    mkdirSync(out, { recursive: true })
  })
  afterEach(() => rmSync(out, { recursive: true, force: true }))

  it('reads what prepare wrote, is undefined without it, and is cleared on a rerun', () => {
    expect(readDependencies(out)).toBeUndefined()
    writeFileSync(join(out, DEPENDENCIES_FILE), JSON.stringify([dep('#1')]))
    expect(readDependencies(out)).toEqual([dep('#1')])
    clearDependencies(out)
    expect(readDependencies(out)).toBeUndefined()
  })
})

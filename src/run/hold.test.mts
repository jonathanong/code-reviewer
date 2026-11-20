import { describe, expect, it } from 'vitest'

import { DEFAULT_RUN } from '../review/rules/run-parse.mts'
import { holdRules, type HoldFacts } from './hold.mts'

const CLEAN: HoldFacts = {
  questions: 0,
  files: 3,
  lines: 40,
  truncated: [],
  securityPaths: [],
  partial: [],
  authMode: 'app',
  tooLong: [],
}

const names = (facts: Partial<HoldFacts>, settings = DEFAULT_RUN) =>
  holdRules({ ...CLEAN, ...facts }, settings).map((held) => held.rule)

describe('holdRules', () => {
  it('holds nothing for a small, clean review under the App', () => {
    expect(holdRules(CLEAN, DEFAULT_RUN)).toEqual([])
  })

  it('holds on an open question', () => {
    expect(names({ questions: 2 })).toEqual(['unclear-intent'])
  })

  it('holds on more files or more lines than the limits, and not at the limit', () => {
    expect(names({ files: 51 })).toEqual(['large-change'])
    expect(names({ lines: 1001 })).toEqual(['large-change'])
    expect(names({ files: 50, lines: 1000 })).toEqual([])
  })

  it('holds a change that was cut short, however small', () => {
    const held = holdRules({ ...CLEAN, truncated: ['diff skipped'] }, DEFAULT_RUN)
    expect(held).toEqual([{ rule: 'large-change', why: 'cut short: diff skipped' }])
  })

  it('holds on security paths and names at most five', () => {
    const securityPaths = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `${name}/auth.ts`)
    const [held] = holdRules({ ...CLEAN, securityPaths }, DEFAULT_RUN)
    expect(held).toEqual({
      rule: 'risky-change',
      why: 'touches security paths: a/auth.ts, b/auth.ts, c/auth.ts, d/auth.ts, e/auth.ts',
    })
  })

  it('holds on a partial failure and on the local gh login', () => {
    expect(names({ partial: ['pillar security failed'] })).toEqual(['partial-failure'])
    expect(names({ authMode: 'gh' })).toEqual(['not-app-identity'])
  })

  it('holds on posted text the post would refuse', () => {
    expect(names({ tooLong: ['body'] })).toEqual(['text-too-long'])
  })

  it('lists every matching rule in a fixed order', () => {
    expect(names({ authMode: 'gh', questions: 1, files: 99, securityPaths: ['x'] })).toEqual([
      'unclear-intent',
      'large-change',
      'risky-change',
      'not-app-identity',
    ])
  })

  it('skips a rule that is switched off and uses configured limits', () => {
    const off = { ...DEFAULT_RUN, rules: { ...DEFAULT_RUN.rules, 'not-app-identity': false } }
    expect(names({ authMode: 'gh' }, off)).toEqual([])
    const small = { ...DEFAULT_RUN, largeChange: { files: 2, lines: 10 } }
    expect(names({ files: 3 }, small)).toEqual(['large-change'])
  })
})

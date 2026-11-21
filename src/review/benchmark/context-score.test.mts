import { describe, expect, it } from 'vitest'

import { renderContext, summarizeContext } from './context-score.mts'

const rules = [
  {
    id: 'r1',
    skills: [
      { skill: 'p:a', status: 'full' as const, quotedChars: 100 },
      { skill: 'p:b', status: 'part' as const, quotedChars: 300 },
    ],
    rules: [
      { skill: 'p:a', text: 'x', outcome: 'present' as const },
      { skill: 'p:b', text: 'y', outcome: 'cut' as const },
    ],
    sectionChars: 500,
    cap: 6000,
  },
  { id: 'r2', skills: [], rules: [], sectionChars: 0, cap: 6000 },
]
const history = [
  {
    id: 'h1',
    rows: [
      { what: 'history' as const, detail: 'abc under a.txt', found: true },
      { what: 'linked' as const, detail: 'abc', found: false },
    ],
    sectionChars: 10,
  },
]

describe('summarizeContext', () => {
  it('counts skills, rules and checks, and the largest quote and section', () => {
    const summary = summarizeContext(rules, history, 6000)
    expect(summary.rules).toEqual({
      cases: 2,
      skills: { full: 1, part: 1, none: 0, absent: 0 },
      expectedRules: { present: 1, cut: 1, missing: 0, absent: 0 },
      maxQuotedChars: 300,
      cap: 6000,
      maxSectionChars: 500,
    })
    expect(summary.history).toEqual({ cases: 1, checks: 2, found: 1 })
  })

  it('is zero for no cases', () => {
    expect(summarizeContext([], [], 6000).rules.maxQuotedChars).toBe(0)
  })
})

describe('renderContext', () => {
  it('renders both tables, marking a rule-less case and a missed check', () => {
    const text = renderContext(rules, history, summarizeContext(rules, history, 6000))
    expect(text).toContain('| r1 | p:a full 100; p:b part 300 | p:a present; p:b cut | 500 |')
    expect(text).toContain('| r2 |  | none declared | 0 |')
    expect(text).toContain('Skills: 1 full, 1 part, 0 none, 0 absent.')
    expect(text).toContain('300 of 6000 characters')
    expect(text).toContain('| h1 | linked abc | NO |')
    expect(text).toContain('Found 1 of 2 checks.')
  })

  it('leaves out a part with no cases', () => {
    const text = renderContext([], [], summarizeContext([], [], 6000))
    expect(text).toBe('# Context bench\n')
  })
})

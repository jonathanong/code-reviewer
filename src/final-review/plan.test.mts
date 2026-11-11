import { describe, expect, it } from 'vitest'

import type { FollowUpContext } from './context.mts'
import { planReview, type PlanInput } from './plan.mts'

const HEAD = 'a'.repeat(40)
const OLD = 'b'.repeat(40)

function context(overrides: Partial<FollowUpContext> = {}): FollowUpContext {
  return {
    title: 'T',
    headSha: HEAD,
    baseSha: 'c'.repeat(40),
    lines: 1000,
    reviewedSha: null,
    verdict: null,
    effort: null,
    commitsSince: null,
    unresolved: [],
    others: [],
    ...overrides,
  }
}

function finding(pillar: string) {
  return {
    threadId: 't',
    severity: 'high',
    pillar,
    title: 'x',
    path: 'a.ts',
    line: 1,
    outdated: false,
  }
}

type Plan = ReturnType<typeof planReview>
const names = (result: Plan) => result.pillars.map((p) => p.pillar)
const skipped = (result: Plan) =>
  Object.fromEntries(result.skipped.map((s) => [s.pillar, s.reason]))

function plan(input: Partial<PlanInput> = {}) {
  return planReview({ paths: ['src/a.ts'], context: context(), ...input })
}

describe('planReview full reviews', () => {
  it('plans a first review at high effort', () => {
    const result = plan()
    expect(result).toMatchObject({
      upToDate: false,
      effort: 'high',
      sinceSha: null,
      verifierModel: 'opus',
      reasons: [],
    })
    expect(names(result)).toEqual(['rules', 'correctness', 'design', 'blast-radius'])
    expect(result.pillars.every((p) => p.model === 'sonnet')).toBe(true)
    expect(skipped(result)).toEqual({
      security: 'No security trigger paths changed.',
      history: 'History not checked.',
    })
  })

  it('respects a requested medium effort', () => {
    expect(plan({ requested: 'medium' }).effort).toBe('medium')
  })

  it('reviews only rules on haiku for docs-only changes', () => {
    const result = plan({ paths: ['README.md'] })
    expect(result.pillars).toEqual([{ pillar: 'rules', model: 'haiku' }])
    expect(skipped(result).correctness).toBe('Docs-only change.')
    expect(skipped(result).design).toBe('Docs-only change.')
  })

  it('skips blast-radius for test-only changes', () => {
    const result = plan({ paths: ['a.test.ts'] })
    expect(names(result)).toEqual(['rules', 'correctness', 'design'])
    expect(skipped(result)['blast-radius']).toBe('Test- or docs-only change.')
  })

  it('adds security with a reason on trigger paths', () => {
    const result = plan({ paths: ['src/auth.ts'] })
    expect(names(result)).toContain('security')
    expect(result.reasons).toEqual(['Security trigger: src/auth.ts.'])
  })

  it('adds history on haiku when history hits exist', () => {
    const result = plan({ history: ['Revert "x"'] })
    expect(result.pillars.at(-1)).toEqual({ pillar: 'history', model: 'haiku' })
  })

  it('explains skipped history', () => {
    expect(skipped(plan({ history: [] })).history).toBe('No reverts found.')
    expect(skipped(plan()).history).toBe('History not checked.')
  })

  it('marks the plan up to date when the head was reviewed', () => {
    expect(plan({ context: context({ reviewedSha: HEAD }) }).upToDate).toBe(true)
  })
})

describe('planReview follow-ups', () => {
  const since = { status: 'ahead', paths: ['src/new.ts'], lines: 100 }
  const reviewed = (extra: Partial<FollowUpContext> = {}) => context({ reviewedSha: OLD, ...extra })

  it('defaults to a low follow-up on the new commits', () => {
    const result = plan({
      context: reviewed({ unresolved: [finding('security'), finding('congruence')] }),
      since,
    })
    expect(result.effort).toBe('low')
    expect(result.sinceSha).toBe(OLD)
    expect(names(result)).toEqual(['correctness', 'security'])
    expect(result.verifierModel).toBe('sonnet')
    expect(skipped(result).rules).toBe('Low-effort follow-up without an open finding.')
    expect(skipped(result).history).toBe('Low-effort follow-up without an open finding.')
    expect(result.reasons).toEqual([])
  })

  it('adds security from since paths and never history on low', () => {
    const result = plan({
      context: reviewed(),
      since: { ...since, paths: ['src/auth.ts'] },
      history: ['hotfix'],
    })
    expect(names(result)).toEqual(['correctness', 'security'])
  })

  it('uses opus for large follow-ups', () => {
    const result = plan({ context: reviewed({ lines: 5000 }), since: { ...since, lines: 301 } })
    expect(result.effort).toBe('low')
    expect(result.verifierModel).toBe('opus')
  })

  it('handles docs-only low follow-ups', () => {
    const result = plan({ context: reviewed(), since: { ...since, paths: ['a.md'] } })
    expect(result.pillars).toEqual([{ pillar: 'correctness', model: 'haiku' }])
  })

  it('escalates a requested low review with no earlier review', () => {
    const result = plan({ requested: 'low' })
    expect(result.effort).toBe('high')
    expect(result.reasons).toEqual(['No earlier final review: high effort.'])
  })

  it.each([undefined, { status: 'diverged', paths: [], lines: 0 }])(
    'escalates when the reviewed SHA is not an ancestor (%j)',
    (diff) => {
      const result = plan({ context: reviewed(), ...(diff === undefined ? {} : { since: diff }) })
      expect(result.effort).toBe('high')
      expect(result.sinceSha).toBeNull()
      expect(result.reasons).toEqual([
        'The reviewed SHA is not an ancestor of the head: high effort.',
      ])
    },
  )

  it('escalates when new commits change more than half the pull request', () => {
    const result = plan({ context: reviewed({ lines: 100 }), since: { ...since, lines: 51 } })
    expect(result.effort).toBe('high')
    expect(result.reasons).toEqual([
      'New commits change more than half the pull request: high effort.',
    ])
  })
})

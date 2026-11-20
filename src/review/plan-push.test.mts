import { describe, expect, it } from 'vitest'

import type { FollowUpContext } from './context.mts'
import { planReview, type PlanInput } from './plan.mts'

const HEAD = 'a'.repeat(40)
const OLD = 'b'.repeat(40)

const context = (overrides: Partial<FollowUpContext> = {}): FollowUpContext => ({
  title: 'T',
  author: null,
  intent: { body: '', issues: [] },
  headSha: HEAD,
  baseSha: 'c'.repeat(40),
  lines: 1000,
  reviewedSha: OLD,
  verdict: null,
  effort: null,
  commitsSince: null,
  truncated: false,
  unresolved: [],
  priorQuestions: [],
  others: [],
  ...overrides,
})

const merges: NonNullable<PlanInput['push']> = { kind: 'base-merges-only', resolvedPaths: [] }
// What the compare API says about merged-in base changes: more than half of the pull request.
const since = { status: 'ahead', paths: ['src/incoming.ts', 'src/auth.ts'], lines: 900 }

function plan(input: Partial<PlanInput> = {}) {
  return planReview({
    paths: ['src/a.ts'],
    reviewableLines: 1000,
    context: context(),
    ...input,
  })
}

describe('planReview for a push that only merges the base or rewrites history', () => {
  it('is a light review of correctness alone, even when the incoming change is large', () => {
    const result = plan({ push: merges, since })
    expect(result).toMatchObject({
      mode: 'light',
      effort: 'low',
      sinceSha: null,
      push: 'base-merges-only',
      verifierModel: 'sonnet',
    })
    expect(result.pillars).toEqual([{ pillar: 'correctness', model: 'sonnet' }])
    expect(result.reasons).toEqual([
      'The push since the earlier review only merges the base: light review of the merge resolutions and of what came in.',
    ])
  })

  it('does not run the pillars of an unresolved finding, which the verifier rechecks', () => {
    const unresolved = [
      {
        threadId: 't',
        severity: 'high',
        pillar: 'design',
        title: 'x',
        path: 'a.ts',
        line: 1,
        outdated: false,
      },
    ]
    const result = plan({ push: merges, context: context({ unresolved }) })
    expect(result.pillars.map(({ pillar }) => pillar)).toEqual(['correctness'])
  })

  it('needs no since diff for a rewrite and says why it is light', () => {
    const result = plan({
      push: { kind: 'rebase-same-change', resolvedPaths: [] },
      since: { status: 'diverged', paths: [], lines: 0 },
    })
    expect(result).toMatchObject({ mode: 'light', push: 'rebase-same-change', sinceSha: null })
    expect(result.reasons[0]).toContain('History was rewritten')
  })

  it('adds the security pillar only for a path a resolution touched, not for incoming files', () => {
    const quiet = plan({ push: merges, since })
    expect(quiet.pillars.map(({ pillar }) => pillar)).toEqual(['correctness'])
    const touched = plan({ push: { ...merges, resolvedPaths: ['src/auth.ts'] }, since })
    expect(touched.pillars.map(({ pillar }) => pillar)).toEqual(['correctness', 'security'])
    expect(touched.reasons).toContain('Security trigger: src/auth.ts.')
  })

  it('keeps a docs-only resolution on the sonnet tier, since the merge may break code', () => {
    const result = plan({ push: { ...merges, resolvedPaths: ['README.md'] } })
    expect(result.pillars).toEqual([{ pillar: 'correctness', model: 'sonnet' }])
  })

  it('still escalates a truncated review conversation and honors --effort', () => {
    const truncated = plan({ push: merges, context: context({ truncated: true }) })
    expect(truncated).toMatchObject({ mode: 'full', effort: 'high' })
    expect(truncated.push).toBeUndefined()
    const forced = plan({ push: merges, requested: 'medium' })
    expect(forced).toMatchObject({ mode: 'full', effort: 'medium' })
    expect(forced.push).toBeUndefined()
  })

  it('leaves a follow-up with no push exactly as it was', () => {
    const result = plan({ since: { status: 'ahead', paths: ['src/new.ts'], lines: 10 } })
    expect(result).toMatchObject({ mode: 'light', sinceSha: OLD })
    expect('push' in result).toBe(false)
  })
})

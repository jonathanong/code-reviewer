import { describe, expect, it } from 'vitest'

import type { AuthorRule } from './author-rules.mts'
import type { FollowUpContext } from './context.mts'
import { DEFAULT_PLAN_VALUES, type PlanValues } from './plan-settings.mts'
import { planReview, type PlanInput } from './plan.mts'

const context = (reviewedSha: string | null = null): FollowUpContext => ({
  title: 'T',
  author: 'dependabot[bot]',
  intent: { body: '', issues: [] },
  headSha: 'a'.repeat(40),
  baseSha: 'c'.repeat(40),
  lines: 1000,
  reviewedSha,
  verdict: null,
  effort: null,
  commitsSince: null,
  unread: { threads: 0, ownReview: false },
  olderSkipped: false,
  unresolved: [],
  priorQuestions: [],
  others: [],
  othersDropped: 0,
  restatable: [],
  answerable: [],
})

const values = (authors: AuthorRule[]): PlanValues => ({ ...DEFAULT_PLAN_VALUES, authors })

const plan = (input: Partial<PlanInput> = {}) =>
  planReview({
    paths: ['package.json', '.github/workflows/ci.yml'],
    reviewableLines: 1000,
    context: context(),
    authorLogin: 'dependabot[bot]',
    authorIsBot: true,
    ...input,
  })

const SUSPENDED = 'Commits by others on a dependabot[bot] pull request: normal review.'
const pillars = (result: ReturnType<typeof plan>) => result.pillars.map((p) => p.pillar)

describe('planReview author rules', () => {
  it('reviews a pull request by a light-rule author lightly, without dependency-file security triggers', () => {
    const result = plan()
    expect(result.mode).toBe('light')
    expect(pillars(result)).not.toContain('security')
  })

  it('applies the normal plan, with security back on, once someone else pushed', () => {
    const result = plan({ authorSuspended: SUSPENDED })
    expect(result.mode).toBe('full')
    expect(pillars(result)).toContain('security')
    expect(result.reasons).toContain(SUSPENDED)
  })

  it('does not skip a lockfile-only pull request once someone else pushed', () => {
    const lockfiles = { paths: ['pnpm-lock.yaml'] }
    expect(plan(lockfiles).mode).toBe('skip')
    expect(plan({ ...lockfiles, authorSuspended: SUSPENDED }).mode).not.toBe('skip')
  })

  it('never reviews a skip-rule author, and lets --effort force a review', () => {
    const skip = values([{ login: 'Dependabot', review: 'skip' }])
    const skipped = plan({ values: skip })
    expect(skipped).toMatchObject({ mode: 'skip', pillars: [] })
    expect(skipped.skipReason).toContain('skip')
    const forced = plan({ values: skip, requested: 'high' })
    expect(forced.mode).toBe('full')
    expect(forced.reasons[0]).toContain('--effort high')
  })

  it('reviews a skip-rule author normally once someone else pushed', () => {
    const skip = values([{ login: 'dependabot', review: 'skip' }])
    const result = plan({ values: skip, authorSuspended: SUSPENDED })
    expect(result.mode).toBe('full')
    expect(pillars(result)).toContain('security')
  })

  it('keeps security triggers for a skip-rule author when a review is forced', () => {
    const skip = values([{ login: 'dependabot', review: 'skip' }])
    expect(pillars(plan({ values: skip, requested: 'high' }))).toContain('security')
  })

  it('lets a configured rule override the built-in Dependabot rule', () => {
    const light = values([{ login: 'dependabot', review: 'light' }])
    expect(plan({ values: light, paths: ['pnpm-lock.yaml'] }).mode).toBe('skip')
  })
})

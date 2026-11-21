import { describe, expect, it } from 'vitest'

import type { FollowUpContext } from './context.mts'
import { DEFAULT_PLAN_VALUES, SMALL_PR_LINES, type PlanValues } from './plan-settings.mts'
import { planReview, type PlanInput } from './plan.mts'

const HEAD = 'a'.repeat(40)
const OLD = 'b'.repeat(40)

function context(overrides: Partial<FollowUpContext> = {}): FollowUpContext {
  return {
    title: 'T',
    author: 'octocat',
    intent: { body: '', issues: [] },
    headSha: HEAD,
    baseSha: 'c'.repeat(40),
    lines: 1000,
    reviewedSha: null,
    verdict: null,
    effort: null,
    commitsSince: null,
    truncated: false,
    unresolved: [],
    priorQuestions: [],
    others: [],
    restatable: [],
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

function plan(
  input: Partial<Omit<PlanInput, 'reviewableLines'>> & { reviewableLines?: number } = {},
) {
  const base = input.context ?? context()
  return planReview({ paths: ['src/a.ts'], reviewableLines: base.lines, context: base, ...input })
}

describe('planReview full reviews', () => {
  it('plans a first review at high effort', () => {
    const result = plan()
    expect(result).toMatchObject({
      upToDate: false,
      mode: 'full',
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

  it('skips blast-radius for test-only changes when full review is requested', () => {
    const result = plan({ paths: ['a.test.ts'], requested: 'high' })
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
    expect(result.mode).toBe('light')
    expect(result.effort).toBe('low')
    expect(result.sinceSha).toBe(OLD)
    expect(names(result)).toEqual(['correctness', 'security'])
    expect(result.verifierModel).toBe('sonnet')
    expect(skipped(result).rules).toBe('Low-effort follow-up without an open finding.')
    expect(skipped(result).history).toBe('Low-effort follow-up without an open finding.')
    expect(result.reasons).toEqual([
      'Follow-up after an earlier review: light review of the new commits.',
    ])
  })

  it('adds security from since paths and never history on low', () => {
    const result = plan({
      context: reviewed(),
      since: { ...since, paths: ['src/auth.ts'] },
      history: ['hotfix'],
    })
    expect(names(result)).toEqual(['correctness', 'security'])
  })

  it('keeps a sonnet verifier for large light follow-ups', () => {
    const result = plan({ context: reviewed({ lines: 5000 }), since: { ...since, lines: 301 } })
    expect(result).toMatchObject({ mode: 'light', effort: 'low', verifierModel: 'sonnet' })
  })

  it('handles docs-only low follow-ups', () => {
    const result = plan({ context: reviewed(), since: { ...since, paths: ['a.md'] } })
    expect(result.pillars).toEqual([{ pillar: 'correctness', model: 'haiku' }])
  })

  it('escalates a requested low review with no earlier review', () => {
    const result = plan({ requested: 'low' })
    expect(result).toMatchObject({ mode: 'full', effort: 'high' })
    expect(result.reasons).toEqual(['No earlier review: high effort.'])
  })

  it.each([undefined, { status: 'diverged', paths: [], lines: 0 }])(
    'escalates when the reviewed SHA is not an ancestor (%j)',
    (diff) => {
      const result = plan({ context: reviewed(), ...(diff === undefined ? {} : { since: diff }) })
      expect(result).toMatchObject({ mode: 'full', effort: 'high' })
      expect(result.sinceSha).toBeNull()
      expect(result.reasons).toEqual([
        'The reviewed SHA is not an ancestor of the head: high effort.',
      ])
    },
  )

  it('escalates when new commits change more than half the pull request', () => {
    const result = plan({ context: reviewed({ lines: 100 }), since: { ...since, lines: 51 } })
    expect(result).toMatchObject({ mode: 'full', effort: 'high' })
    expect(result.reasons).toEqual([
      'New commits change more than half the pull request: high effort.',
    ])
  })

  it('escalates when the conversation was truncated', () => {
    const result = plan({ context: reviewed({ truncated: true }), since })
    expect(result).toMatchObject({ mode: 'full', effort: 'high' })
    expect(result.reasons).toEqual([
      'The review conversation is longer than the digest reads: high effort.',
    ])
  })

  it('escalates when the compare API truncated the since diff', () => {
    const result = plan({ context: reviewed(), since: { ...since, truncated: true } })
    expect(result).toMatchObject({ mode: 'full', effort: 'high' })
    expect(result.reasons).toEqual([
      'The diff since the reviewed SHA is too large to list: high effort.',
    ])
  })
})

describe('planReview skip', () => {
  const dependabot = { authorLogin: 'dependabot[bot]', authorIsBot: true }

  it('skips a Dependabot pull request that changes only lockfiles', () => {
    const result = plan({ ...dependabot, paths: ['pnpm-lock.yaml', 'apps/a/Cargo.lock'] })
    expect(result).toMatchObject({ mode: 'skip', effort: 'low', sinceSha: null, pillars: [] })
    expect(result.skipReason).toBe(
      'Dependabot pull request that changes only lockfiles: no review.',
    )
    expect(result.reasons).toEqual([result.skipReason])
    expect(result.skipped).toHaveLength(6)
    expect(result.skipped.every((s) => s.reason === result.skipReason)).toBe(true)
  })

  it.each(['dependabot[bot]', 'app/dependabot'])('recognizes the login %s', (authorLogin) => {
    expect(plan({ authorLogin, paths: ['yarn.lock'] }).mode).toBe('skip')
  })

  it('recognizes the bare login only for a bot account', () => {
    expect(plan({ authorLogin: 'dependabot', authorIsBot: true, paths: ['go.sum'] }).mode).toBe(
      'skip',
    )
    expect(plan({ authorLogin: 'dependabot', paths: ['go.sum'] }).mode).not.toBe('skip')
  })

  it('does not skip other authors, mixed paths, or an empty file list', () => {
    expect(plan({ authorLogin: 'dev', paths: ['yarn.lock'] }).mode).not.toBe('skip')
    expect(plan({ authorLogin: null, paths: ['yarn.lock'] }).mode).not.toBe('skip')
    expect(plan({ ...dependabot, paths: ['yarn.lock', 'src/a.ts'] }).mode).toBe('light')
    expect(plan({ ...dependabot, paths: [] }).mode).toBe('light')
  })

  it.each(['medium', 'high', 'low'] as const)(
    'reviews a skip case when --effort %s is given',
    (requested) => {
      const result = plan({ ...dependabot, paths: ['yarn.lock'], requested })
      expect(result.mode).not.toBe('skip')
      expect(result.skipReason).toBeUndefined()
      expect(result.reasons[0]).toBe(
        `Dependabot lockfile-only pull request: --effort ${requested} forces a review.`,
      )
      expect(result.pillars.length).toBeGreaterThan(0)
    },
  )

  it('marks a skipped head that was already reviewed as up to date', () => {
    const result = plan({
      ...dependabot,
      paths: ['yarn.lock'],
      context: context({ reviewedSha: HEAD }),
    })
    expect(result).toMatchObject({ mode: 'skip', upToDate: true })
  })
})

describe('planReview light first reviews', () => {
  const dependabot = { authorLogin: 'dependabot[bot]', authorIsBot: true }

  it('runs rules and correctness with a sonnet verifier on a Dependabot pull request', () => {
    const result = plan({ ...dependabot, paths: ['package.json'], history: ['Revert "x"'] })
    expect(result).toMatchObject({
      mode: 'light',
      effort: 'low',
      sinceSha: null,
      verifierModel: 'sonnet',
    })
    expect(names(result)).toEqual(['rules', 'correctness'])
    expect(skipped(result)).toEqual({
      design: 'Light review.',
      'blast-radius': 'Light review.',
      security: 'Light review.',
      history: 'Light review.',
    })
    expect(result.reasons).toEqual(['Dependabot pull request: light review.'])
  })

  it('does not count manifests, lockfiles, or workflows as security triggers for Dependabot', () => {
    const paths = ['package.json', 'pnpm-lock.yaml', '.github/workflows/ci.yml', 'Cargo.toml']
    expect(names(plan({ ...dependabot, paths }))).toEqual(['rules', 'correctness'])
    expect(names(plan({ paths }))).toContain('security')
  })

  it('still triggers security for other Dependabot paths', () => {
    const result = plan({ ...dependabot, paths: ['package.json', 'scripts/deploy.sh'] })
    expect(names(result)).toEqual(['rules', 'correctness', 'security'])
    expect(result.reasons).toContain('Security trigger: scripts/deploy.sh.')
  })

  it('counts reviewable lines, not raw lines, for the small threshold', () => {
    const result = plan({
      context: context({ lines: 9000 }),
      reviewableLines: SMALL_PR_LINES,
    })
    expect(result.mode).toBe('light')
    expect(result.reasons).toEqual([
      `Small pull request (${SMALL_PR_LINES} reviewable lines): light review.`,
    ])
    expect(
      plan({ context: context({ lines: 9000 }), reviewableLines: SMALL_PR_LINES + 1 }).mode,
    ).toBe('full')
  })

  it('reviews a human pull request of only generated files as light, not skipped', () => {
    const result = plan({
      paths: ['pnpm-lock.yaml'],
      context: context({ lines: 4000 }),
      reviewableLines: 0,
    })
    expect(result).toMatchObject({ mode: 'light', verifierModel: 'sonnet' })
    expect(names(result)).toEqual(['rules', 'correctness', 'security'])
  })

  it('does not let a generated trigger path make a small pull request large', () => {
    const result = plan({ paths: ['dist/handler.js', 'src/a.ts'], reviewableLines: 10 })
    expect(result.mode).toBe('light')
  })

  it('compares reviewable lines on both sides of the follow-up rule', () => {
    const reviewed = context({ reviewedSha: OLD, lines: 10_000 })
    const since = { status: 'ahead', paths: ['src/a.ts'], lines: 60 }
    expect(plan({ context: reviewed, since, reviewableLines: 100 }).mode).toBe('full')
    expect(plan({ context: reviewed, since, reviewableLines: 120 }).mode).toBe('light')
  })

  it('keeps full effort for a Dependabot pull request when --effort asks', () => {
    expect(plan({ ...dependabot, requested: 'medium' })).toMatchObject({
      mode: 'full',
      effort: 'medium',
    })
  })

  it('is light for tests-only and mixed docs and tests, without the security rule for docs', () => {
    expect(plan({ paths: ['a.test.ts', 'README.md'] })).toMatchObject({
      mode: 'light',
      effort: 'low',
      verifierModel: 'sonnet',
    })
    const docs = plan({ paths: ['README.md'] })
    expect(docs).toMatchObject({ mode: 'light' })
    expect(docs.pillars).toEqual([{ pillar: 'rules', model: 'haiku' }])
    expect(docs.reasons).toEqual(['Only docs and tests changed: light review.'])
  })

  it('adds security to a tests-only change that touches a trigger path', () => {
    const result = plan({ paths: ['src/auth.test.ts'] })
    expect(result.mode).toBe('light')
    expect(names(result)).toEqual(['rules', 'correctness', 'security'])
  })

  it('is light for a small pull request up to the threshold', () => {
    const result = plan({ context: context({ lines: SMALL_PR_LINES }) })
    expect(result).toMatchObject({ mode: 'light', effort: 'low', verifierModel: 'sonnet' })
    expect(names(result)).toEqual(['rules', 'correctness'])
    expect(result.reasons).toEqual([
      `Small pull request (${SMALL_PR_LINES} reviewable lines): light review.`,
    ])
  })

  it('is full just over the threshold', () => {
    expect(plan({ context: context({ lines: SMALL_PR_LINES + 1 }) }).mode).toBe('full')
  })

  it('is never small when a security trigger path changed', () => {
    const result = plan({ paths: ['src/auth.ts'], context: context({ lines: 5 }) })
    expect(result).toMatchObject({ mode: 'full', effort: 'high', verifierModel: 'opus' })
    expect(names(result)).toContain('security')
  })

  it('lets an explicit effort win over a small pull request', () => {
    const result = plan({ context: context({ lines: 5 }), requested: 'medium' })
    expect(result).toMatchObject({ mode: 'full', effort: 'medium' })
  })

  it('adds security to a light follow-up whose new commits touch a trigger path', () => {
    const result = plan({
      context: context({ reviewedSha: OLD }),
      since: { status: 'ahead', paths: ['.github/workflows/ci.yml'], lines: 10 },
    })
    expect(result.mode).toBe('light')
    expect(names(result)).toEqual(['correctness', 'security'])
  })
})

describe('configured plan values', () => {
  const values = (overrides: Partial<PlanValues>): PlanValues => ({
    ...DEFAULT_PLAN_VALUES,
    ...overrides,
  })

  it('runs the security pillar for a path only a configured pattern matches', () => {
    const paths = ['infra/network.tf']
    expect(names(plan({ paths }))).not.toContain('security')
    const configured = plan({ paths, values: values({ securityPaths: ['infra/**'] }) })
    expect(names(configured)).toContain('security')
    expect(configured.reasons).toContain('Security trigger: infra/network.tf.')
  })

  it('keeps a small change full while a configured security path changes with it', () => {
    const paths = ['infra/network.tf']
    expect(plan({ paths, reviewableLines: 5 }).mode).toBe('light')
    expect(
      plan({ paths, reviewableLines: 5, values: values({ securityPaths: ['infra/**'] }) }).mode,
    ).toBe('full')
  })

  it('does not count a configured generated path toward size or security triggers', () => {
    const paths = ['gen/auth.ts']
    expect(plan({ paths, reviewableLines: 5 }).mode).toBe('full')
    expect(
      plan({ paths, reviewableLines: 5, values: values({ generatedPaths: ['gen/**'] }) }).mode,
    ).toBe('light')
  })

  it('moves the light and full line with the configured threshold', () => {
    const input = { context: context({ lines: 150 }), reviewableLines: 150 }
    expect(plan(input).mode).toBe('full')
    expect(plan({ ...input, values: values({ smallChangeLines: 150 }) }).mode).toBe('light')
    expect(plan({ ...input, values: values({ smallChangeLines: 149 }) }).mode).toBe('full')
    expect(
      plan({ ...input, reviewableLines: 60, values: values({ smallChangeLines: 59 }) }).mode,
    ).toBe('full')
  })

  it('treats a configured author like Dependabot, matching bot and app forms', () => {
    const skipAuthors = ['Renovate[bot]']
    const lockfiles = { paths: ['pnpm-lock.yaml'], values: values({ skipAuthors }) }
    const result = plan({ ...lockfiles, authorLogin: 'app/renovate', authorIsBot: true })
    expect(result).toMatchObject({ mode: 'skip' })
    expect(plan({ ...lockfiles, authorLogin: 'someone-else' }).mode).not.toBe('skip')
    expect(plan({ authorLogin: 'renovate' }).mode).toBe('full')
    const light = plan({ authorLogin: 'renovate', values: values({ skipAuthors }) })
    expect(light).toMatchObject({
      mode: 'light',
      reasons: ['Dependabot pull request: light review.'],
    })
  })
})

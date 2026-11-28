import { describe, expect, it } from 'vitest'

import type { FollowUpContext } from './context.mts'
import { DEFAULT_PLAN_VALUES, type PlanValues } from './plan-settings.mts'
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
    unread: { threads: 0, ownReview: false },
    olderSkipped: false,
    unresolved: [],
    priorQuestions: [],
    others: [],
    othersDropped: 0,
    restatable: [],
    answerable: [],
    ...overrides,
  }
}

const names = (result: ReturnType<typeof planReview>) => result.pillars.map((p) => p.pillar)
const values = (overrides: Partial<PlanValues>): PlanValues => ({
  ...DEFAULT_PLAN_VALUES,
  ...overrides,
})

function plan(
  input: Partial<Omit<PlanInput, 'reviewableLines'>> & { reviewableLines?: number } = {},
) {
  const base = input.context ?? context()
  return planReview({ paths: ['src/a.ts'], reviewableLines: base.lines, context: base, ...input })
}

const reviewed = (extra: Partial<FollowUpContext> = {}) => context({ reviewedSha: OLD, ...extra })

describe('planReview follow-ups that change source', () => {
  const edit = (paths: string[], lines: number, extra: Partial<PlanInput> = {}) =>
    plan({
      context: reviewed({ lines: 10_000 }),
      since: { status: 'ahead', paths, lines },
      ...extra,
    })

  it('escalates above the threshold and says why', () => {
    const result = edit(['src/lock.ts', 'src/lock.test.ts'], 41)
    expect(result).toMatchObject({ mode: 'full', effort: 'high', sinceSha: null })
    expect(result.reasons).toEqual([
      'The new commits change 41 lines of source (src/lock.ts), more than 40: high effort.',
    ])
  })

  it('counts only source lines, not the tests and docs that come with them', () => {
    const since = { status: 'ahead', paths: ['src/lock.ts', 'src/lock.test.ts'], lines: 62 }
    expect(edit(since.paths, 62, {}).mode).toBe('full')
    const fix = plan({ context: reviewed({ lines: 10_000 }), since: { ...since, sourceLines: 2 } })
    expect(fix).toMatchObject({ mode: 'light', sinceSha: OLD })
    const big = plan({ context: reviewed({ lines: 10_000 }), since: { ...since, sourceLines: 41 } })
    expect(big.reasons).toEqual([
      'The new commits change 41 lines of source (src/lock.ts), more than 40: high effort.',
    ])
  })

  it('stays light at the threshold', () => {
    expect(edit(['src/lock.ts'], 40)).toMatchObject({ mode: 'light', sinceSha: OLD })
  })

  it.each([
    ['tests', ['src/a.test.ts']],
    ['docs', ['README.md', 'docs/a.md']],
    ['generated files', ['pnpm-lock.yaml', 'dist/a.js']],
  ])('stays light when only %s change', (_name, paths) => {
    expect(edit(paths, 500).mode).toBe('light')
  })

  it('counts an instruction file as source', () => {
    expect(edit(['skills/review/SKILL.md'], 41).mode).toBe('full')
  })

  it('moves with followUpSourceLines and generatedPaths', () => {
    expect(edit(['src/a.ts'], 41, { values: values({ followUpSourceLines: 100 }) }).mode).toBe(
      'light',
    )
    expect(edit(['src/a.ts'], 11, { values: values({ followUpSourceLines: 10 }) }).mode).toBe(
      'full',
    )
    expect(edit(['gen/a.ts'], 90, { values: values({ generatedPaths: ['gen/**'] }) }).mode).toBe(
      'light',
    )
  })

  it('leaves a push that only merges the base light', () => {
    const result = edit(['src/a.ts'], 500, {
      push: { kind: 'base-merges-only', resolvedPaths: [] },
    })
    expect(result).toMatchObject({ mode: 'light', push: 'base-merges-only' })
  })
})

describe('planReview small and instruction-file changes', () => {
  it('reviews a small pull request in full when it changes SQL', () => {
    const result = plan({ paths: ['src/a.ts', 'db/report.sql'], reviewableLines: 5 })
    expect(result).toMatchObject({ mode: 'full', effort: 'high' })
    expect(result.reasons).toContain('The pull request changes SQL (db/report.sql): high effort.')
    expect(plan({ paths: ['db/migrations/001.ts'], reviewableLines: 5 }).mode).toBe('full')
  })

  it('escalates a configured SQL path even when it has a doc extension', () => {
    const paths = ['db/query.txt']
    expect(plan({ paths, reviewableLines: 5 }).reasons).toEqual([
      'Only docs and tests changed: light review.',
    ])
    const sqlPaths = ['db/**']
    const result = plan({ paths, reviewableLines: 5, values: values({ sqlPaths }) })
    expect(result).toMatchObject({ mode: 'full', effort: 'high' })
    expect(result.reasons[0]).toBe('The pull request changes SQL (db/query.txt): high effort.')
    expect(plan({ paths: ['README.md'], values: values({ sqlPaths }) }).mode).toBe('light')
    const generated = values({ sqlPaths, generatedPaths: ['db/**'] })
    expect(plan({ paths, reviewableLines: 5, values: generated }).mode).toBe('light')
  })

  it('takes a configured sqlPaths glob as SQL, and a generated SQL path as not', () => {
    const paths = ['src/queries/feed.ts']
    expect(plan({ paths, reviewableLines: 5 }).mode).toBe('light')
    const sqlPaths = ['src/queries/**']
    const result = plan({ paths, reviewableLines: 5, values: values({ sqlPaths }) })
    expect(result.mode).toBe('full')
    expect(result.reasons[0]).toContain('changes SQL (src/queries/feed.ts)')
    const generated = values({ sqlPaths, generatedPaths: ['src/queries/**'] })
    expect(plan({ paths, reviewableLines: 5, values: generated }).mode).toBe('light')
  })

  it('reviews a small pull request in full when its changed lines in source are SQL', () => {
    const sqlInCode = ['src/feed.mts']
    const result = plan({ paths: sqlInCode, reviewableLines: 8, sqlInCode })
    expect(result).toMatchObject({ mode: 'full', effort: 'high' })
    expect(result.reasons).toEqual(['The pull request changes SQL in src/feed.mts: high effort.'])
    expect(plan({ paths: sqlInCode, reviewableLines: 8 }).mode).toBe('light')
    const off = values({ sqlInCode: false })
    expect(plan({ paths: sqlInCode, reviewableLines: 8, sqlInCode, values: off }).mode).toBe(
      'light',
    )
  })

  it('escalates a follow-up whose new commits change SQL in source, however small', () => {
    const since = {
      status: 'ahead',
      paths: ['src/feed.mts'],
      lines: 2,
      sqlInCode: ['src/feed.mts'],
    }
    const result = plan({ context: reviewed(), reviewableLines: 200, since })
    expect(result).toMatchObject({ mode: 'full', effort: 'high' })
    expect(result.reasons).toEqual(['The new commits change SQL in src/feed.mts: high effort.'])
    const quiet = { ...since, sqlInCode: [] }
    expect(plan({ context: reviewed(), reviewableLines: 200, since: quiet }).mode).toBe('light')
    const off = values({ sqlInCode: false })
    expect(plan({ context: reviewed(), reviewableLines: 200, since, values: off }).mode).toBe(
      'light',
    )
  })

  it('reviews a pull request that edits only instruction files as code, not as docs', () => {
    const paths = ['skills/review/SKILL.md', 'AGENTS.md']
    const small = plan({ paths, reviewableLines: 10 })
    expect(small.mode).toBe('light')
    expect(small.reasons).toEqual(['Small pull request (10 reviewable lines): light review.'])
    expect(names(small)).toEqual(['rules', 'correctness'])
    const large = plan({ paths, reviewableLines: 300 })
    expect(large.mode).toBe('full')
    expect(names(large)).toContain('blast-radius')
    expect(plan({ paths: ['README.md'], reviewableLines: 300 }).reasons).toEqual([
      'Only docs and tests changed: light review.',
    ])
  })

  it('does not run security on an instruction file named for auth', () => {
    const result = plan({ paths: ['skills/auth-review/SKILL.md'], reviewableLines: 10 })
    expect(names(result)).not.toContain('security')
  })
})

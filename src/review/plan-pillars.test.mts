import { describe, expect, it } from 'vitest'

import type { FollowUpContext } from './context.mts'
import { extraPillar } from './pillar-name.mts'
import { planReview, type PlanInput } from './plan.mts'
import type { PillarSettings } from './pillars-settings.mts'
import type { ExtraPillarConfig, PillarMode } from './rules/pillars-parse.mts'

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

const a11y = (modes: PillarMode[]): ExtraPillarConfig => ({
  name: extraPillar('a11y'),
  modes,
  source: { prompt: 'Check labels.' },
})
const settings = (overrides: Partial<PillarSettings> = {}): PillarSettings => ({
  disabled: [],
  extra: [],
  ...overrides,
})

function plan(pillars?: PillarSettings, input: Partial<PlanInput> = {}) {
  const base = input.context ?? context()
  return planReview({
    paths: ['src/a.ts'],
    reviewableLines: base.lines,
    context: base,
    ...(pillars === undefined ? {} : { pillars }),
    ...input,
  })
}
const names = (result: ReturnType<typeof plan>) => result.pillars.map((entry) => entry.pillar)

describe('planReview with configured pillars', () => {
  it('plans exactly what it did without a pillars setting when none is configured', () => {
    expect(plan(settings())).toEqual(plan())
  })

  it('skips a disabled built-in with its reason in every mode', () => {
    const full = plan(settings({ disabled: ['design', 'history'] }), {
      history: ['Revert "x"'],
    })
    expect(full.mode).toBe('full')
    expect(names(full)).toEqual(['rules', 'correctness', 'blast-radius'])
    expect(full.skipped).toEqual([
      { pillar: 'design', reason: 'Disabled in config.' },
      { pillar: 'security', reason: 'No security trigger paths changed.' },
      { pillar: 'history', reason: 'Disabled in config.' },
    ])
    const light = plan(settings({ disabled: ['rules'] }), { reviewableLines: 10 })
    expect(light.mode).toBe('light')
    expect(names(light)).toEqual(['correctness'])
  })

  it('does not run a disabled security pillar on a security path or a disabled one with an open finding', () => {
    const risky = plan(settings({ disabled: ['security'] }), { paths: ['src/auth/login.ts'] })
    expect(names(risky)).not.toContain('security')
    expect(risky.skipped.find((entry) => entry.pillar === 'security')?.reason).toBe(
      'Disabled in config.',
    )
    const unresolved = [
      {
        threadId: 't',
        severity: 'high',
        pillar: 'design',
        title: 'x',
        path: 'a',
        line: 1,
        outdated: false,
      },
    ]
    const followUp = plan(settings({ disabled: ['design'] }), {
      context: context({ reviewedSha: OLD, unresolved }),
      since: { status: 'ahead', paths: ['src/a.ts'], lines: 5 },
      requested: 'low',
    })
    expect(names(followUp)).toEqual(['correctness'])
  })

  it('runs an extra in the modes it names, after the built-ins, always on the medium tier', () => {
    const full = plan(settings({ extra: [a11y(['full'])] }))
    expect(full.pillars.at(-1)).toEqual({ pillar: 'a11y', model: 'sonnet' })
    expect(names(full)).toEqual(['rules', 'correctness', 'design', 'blast-radius', 'a11y'])
    const light = plan(settings({ extra: [a11y(['full'])] }), { reviewableLines: 10 })
    expect(names(light)).toEqual(['rules', 'correctness'])
    const lightToo = plan(settings({ extra: [a11y(['light', 'full'])] }), { reviewableLines: 10 })
    expect(names(lightToo)).toEqual(['rules', 'correctness', 'a11y'])
  })

  it('keeps an extra on the medium tier for a docs-only change and lists no skip for it', () => {
    const docs = plan(settings({ extra: [a11y(['light', 'full'])] }), { paths: ['README.md'] })
    expect(docs.pillars).toEqual([
      { pillar: 'rules', model: 'haiku' },
      { pillar: 'a11y', model: 'sonnet' },
    ])
    const light = plan(settings({ extra: [a11y(['full'])] }), { reviewableLines: 10 })
    expect(light.skipped.map((entry) => entry.pillar)).not.toContain('a11y')
  })

  it('re-runs an extra with an open finding in a follow-up, and none on a merge-only push', () => {
    const unresolved = [
      {
        threadId: 't',
        severity: 'high',
        pillar: 'a11y',
        title: 'x',
        path: 'a',
        line: 1,
        outdated: false,
      },
    ]
    const followUp = plan(settings({ extra: [a11y(['full'])] }), {
      context: context({ reviewedSha: OLD, unresolved }),
      since: { status: 'ahead', paths: ['src/a.ts'], lines: 5 },
      requested: 'low',
    })
    expect(names(followUp)).toEqual(['correctness', 'a11y'])
    const merge = plan(settings({ extra: [a11y(['light', 'full'])] }), {
      context: context({ reviewedSha: OLD }),
      push: { kind: 'base-merges-only', resolvedPaths: ['src/a.ts'] },
    })
    expect(names(merge)).toEqual(['correctness'])
  })

  it('plans no extra for a skip', () => {
    const skipped = plan(settings({ extra: [a11y(['light', 'full'])] }), {
      context: context({ reviewedSha: HEAD }),
    })
    expect(skipped.mode === 'skip' ? skipped.pillars : []).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'

import type { PushFile } from '../push-file.mts'
import { buildReport, type ReportInput } from './report.mts'
import { renderReport } from './report-render.mts'

const PUSH: PushFile = {
  kind: 'base-merges-only',
  reason: 'Every new commit merges the base.',
  reviewedSha: 'r'.repeat(40),
  headSha: 'h'.repeat(40),
  merges: [
    { sha: 'a'.repeat(40), resolution: 'clean' },
    { sha: 'b'.repeat(40), resolution: 'resolved', file: 'merges/b.patch' },
  ],
  mergesCapped: true,
  mergesTotal: 25,
  resolvedPaths: ['src/a.ts'],
  problems: ['git is older than 2.36 (no remerge-diff)'],
}

const RANGE = { rangeDiff: 'range-diff.txt' }

const INPUT: ReportInput = {
  repo: 'acme/widgets',
  pr: 2,
  title: 'Mine',
  headSha: 'a'.repeat(40),
  mode: 'light',
  effort: 'low',
  reasons: [],
  verdict: 'Approve',
  skipped: [],
  skillSelection: { selected: [], available: 0, usage: null },
  pillars: [],
}

describe('a report for a re-review after a push', () => {
  it('records the kind and the merges checked in report.json, without file paths', () => {
    const data = buildReport({ ...INPUT, push: { ...PUSH, ...RANGE } })
    expect(data.push).toEqual({
      kind: 'base-merges-only',
      reason: 'Every new commit merges the base.',
      merges: [
        { sha: 'a'.repeat(40), resolution: 'clean' },
        { sha: 'b'.repeat(40), resolution: 'resolved' },
      ],
      mergesTotal: 25,
      mergesCapped: true,
      rangeDiff: true,
      problems: ['git is older than 2.36 (no remerge-diff)'],
    })
  })

  it('shows the push kind, each merge, the cap, the range-diff and the problems', () => {
    const text = renderReport(buildReport({ ...INPUT, push: { ...PUSH, ...RANGE } }))
    expect(text).toContain('### Push since the last review: base-merges-only')
    expect(text).toContain('Merges checked (2 of 25, capped):')
    expect(text).toContain(`- \`${'a'.repeat(7)}\`: clean merge`)
    expect(text).toContain(`- \`${'b'.repeat(7)}\`: conflict resolution reviewed`)
    expect(text).toContain('The range-diff of the rewrite was reviewed.')
    expect(text).toContain('Problem: git is older than 2.36')
  })

  it('shows a rewrite with no merges as just its kind', () => {
    const rewrite = {
      ...PUSH,
      kind: 'rebase-same-change' as const,
      merges: [],
      mergesCapped: false,
      problems: [],
    }
    const text = renderReport(buildReport({ ...INPUT, push: rewrite }))
    expect(text).toContain('### Push since the last review: rebase-same-change')
    expect(text).not.toContain('Merges checked')
    expect(text).not.toContain('range-diff of the rewrite')
  })

  it('leaves a first review without a push section', () => {
    const data = buildReport(INPUT)
    expect(data.push).toBeUndefined()
    expect(renderReport(data)).not.toContain('Push since the last review')
  })
})

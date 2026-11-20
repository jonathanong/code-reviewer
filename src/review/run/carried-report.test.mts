import { describe, expect, it } from 'vitest'

import type { CarriedFile } from '../carried-file.mts'
import { buildReport, type ReportInput } from './report.mts'
import { renderReport } from './report-render.mts'

const CARRIED: CarriedFile = {
  commits: [
    {
      sha: 'a'.repeat(40),
      subject: 'Parent `work`',
      home: { kind: 'pull', number: 5 },
      how: 'content',
    },
  ],
  commitsInRange: 3,
  files: ['src/p.ts'],
  filesTotal: 1,
  defaultBranch: 'main',
  base: 'missing',
  problems: ['Whether the base branch was merged could not be read: rate limited'],
  baseRef: 'parent',
}

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

describe('a report with carried commits', () => {
  it('keeps the carried file in report.json and shows it in report.md', () => {
    const data = buildReport({ ...INPUT, carried: CARRIED })
    expect(data.carried).toEqual(CARRIED)
    const text = renderReport(data)
    expect(text).toContain('### Carried changes')
    expect(text).toContain('- Base branch `parent` no longer exists')
    expect(text).toContain('`aaaaaaa` Parent work: in #5, by content')
    expect(text).toContain('1 file(s) are changed only by those commits.')
    expect(text).toContain('Problem: Whether the base branch was merged could not be read')
  })

  it('shows a dead base alone, without a commit list or a file count', () => {
    const text = renderReport(
      buildReport({
        ...INPUT,
        carried: { ...CARRIED, commits: [], files: [], filesTotal: 0, problems: [] },
      }),
    )
    expect(text).toContain('### Carried changes')
    expect(text).not.toContain('not reviewed as this pull request')
    expect(text).not.toContain('changed only by those commits')
    expect(text).not.toContain('Problem:')
  })

  it('leaves a review without carried.json with no carried section', () => {
    const data = buildReport(INPUT)
    expect(data.carried).toBeUndefined()
    expect(renderReport(data)).not.toContain('Carried changes')
  })
})

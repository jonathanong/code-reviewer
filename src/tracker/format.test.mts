import { describe, expect, it } from 'vitest'

import { formatRows } from './format.mts'
import type { TrackerRow } from './types.mts'

function row(overrides: Partial<TrackerRow> = {}): TrackerRow {
  return {
    repo: 'acme/widgets',
    pr: 4,
    head: 'a'.repeat(40),
    state: 'reviewed',
    title: 'Add widgets',
    author: 'octocat',
    mode: 'full',
    verdict: 'Comment',
    counts: { blocking: 0, high: 1, medium: 0, low: 2 },
    questions: 3,
    costUsd: 1.5,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:10:00.000Z',
    reason: null,
    reviewUrl: null,
    reviewId: null,
    event: null,
    downgraded: null,
    postedAt: null,
    runDir: '/runs/4',
    ...overrides,
  }
}

describe('formatRows', () => {
  it('prints JSON with every field', () => {
    expect(JSON.parse(formatRows([row()], 'json'))).toEqual([row()])
  })

  it('prints CSV with one column per count', () => {
    const [header, line] = formatRows([row()], 'csv').split('\r\n')
    expect(header).toBe(
      'repo,pr,title,author,head,mode,verdict,blocking,high,medium,low,questions,costUsd,startedAt,finishedAt,state,reason,reviewUrl,reviewId,event,downgraded,postedAt,runDir',
    )
    expect(line).toBe(
      `acme/widgets,4,Add widgets,octocat,${'a'.repeat(40)},full,Comment,0,1,0,2,3,1.5,2026-01-01T00:00:00.000Z,2026-01-01T00:10:00.000Z,reviewed,,,,,,,/runs/4`,
    )
  })

  it('escapes quotes, commas and newlines in a CSV cell', () => {
    const csv = formatRows([row({ title: 'Say "hi", then\nleave' })], 'csv')
    expect(csv).toContain('"Say ""hi"", then\nleave"')
  })

  it('leaves unknown counts empty and neutralizes a title a spreadsheet would run as a formula', () => {
    const [, line] = formatRows([row({ title: '=HYPERLINK("x")', counts: null })], 'csv').split(
      '\r\n',
    )
    expect(line).toContain(`"'=HYPERLINK(""x"")"`)
    expect(line).toContain('Comment,,,,,3,')
  })

  it('prints a Markdown table with pipes and line breaks escaped', () => {
    const lines = formatRows([row({ title: 'a | b\nc', author: null })], 'markdown').split('\n')
    expect(lines[0]).toMatch(/^\| repo \| pr \| title /u)
    expect(lines[1]).toMatch(/^\| --- \| --- /u)
    expect(lines[2]).toContain('| a \\| b c |  |')
    expect(lines[2]).toContain('| 0 | 1 | 0 | 2 |')
  })

  it('prints only the header when there are no rows', () => {
    expect(formatRows([], 'csv')).toMatch(/^repo,pr,[^\r\n]*\r\n$/u)
  })
})

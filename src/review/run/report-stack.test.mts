import { describe, expect, it } from 'vitest'

import { parseUsage } from '../benchmark/usage.mts'
import type { Finding } from '../finding.mts'
import type { StackFile } from '../stack-file.mts'
import { buildReport, type ReportInput } from './report.mts'
import { renderReport } from './report-render.mts'
import type { ReviewVerifierOutput } from './verify.mts'

const member = (number: number, title: string) => ({
  number,
  title,
  headRef: `h${number}`,
  baseRef: `b${number}`,
  headSha: 's',
})

const STACK: StackFile = {
  members: [member(1, 'Base'), member(2, 'Mine'), member(3, 'Top')],
  index: 1,
  rootBase: 'trunk',
  rootIsDefault: false,
  staleBase: false,
}

const real: Finding = { pillar: 'rules', severity: 'high', title: 'Real', body: 'Still wrong.' }
const later: Finding = {
  pillar: 'correctness',
  severity: 'low',
  title: 'Gap',
  body: 'Fixed in #3: the top member adds the check.',
}

const OUTPUT: ReviewVerifierOutput = {
  summary: 'S.',
  pullRequestSummary: 'P.',
  findings: [real, later],
  sources: [[0], [1]],
  dropped: new Map(),
  questions: [],
  fixedThreadIds: [],
  skills: [],
  usage: parseUsage({ total_cost_usd: 1, num_turns: 2 }),
}

const INPUT: ReportInput = {
  repo: 'acme/widgets',
  pr: 2,
  title: 'Mine',
  headSha: 'a'.repeat(40),
  mode: 'full',
  effort: 'high',
  reasons: [],
  verdict: 'Comment',
  skipped: [],
  skillSelection: { selected: [], available: 0, usage: null },
  pillars: [],
  verifier: { model: 'opus', output: OUTPUT },
}

describe('a report for a stacked pull request', () => {
  const data = buildReport({ ...INPUT, stack: STACK })
  const text = renderReport(data)

  it('records the stack and the findings a later member fixes in report.json', () => {
    expect(data.stack?.fixedLater).toEqual([{ finding: 1, pr: 3 }])
    expect(data.stack).toMatchObject({ index: 1, rootBase: 'trunk', rootIsDefault: false })
  })

  it('shows the members, the off-base note, and marks only the fixed-later finding', () => {
    expect(text).toContain('### Stack (member 2 of 3, bottom-up)')
    expect(text).toContain('2. #2 Mine (this pull request)')
    expect(text).toContain('Off-base')
    expect(text).toContain('Gap (correctness) (fixed in a later member, #3)')
    expect(text).not.toContain('Real (rules) (fixed')
  })

  it('leaves a flat report without a stack section', () => {
    const flat = buildReport(INPUT)
    expect(flat.stack).toBeUndefined()
    expect(renderReport(flat)).not.toContain('### Stack')
    expect(renderReport(flat)).not.toContain('fixed in a later')
  })
})

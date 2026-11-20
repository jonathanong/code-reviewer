import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createTrackerIo } from '../tracker/io.mts'
import { explainRun } from './explain.mts'

const FIXTURES = resolve(import.meta.dirname, 'fixtures')
const io = createTrackerIo({ CODE_REVIEWER_STATE_DIR: resolve(FIXTURES, 'none') })

const explain = (name: string, fallback = {}) => explainRun(io, resolve(FIXTURES, name), fallback)

function headings(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('#'))
}

describe('explainRun', () => {
  it('explains a full review in the order a reader needs it', () => {
    expect(headings(explain('full'))).toEqual([
      '# acme/widgets#4: Cache widget lookups',
      '## What this pull request does',
      '## Verdict: Request Changes',
      '## Findings (3)',
      '### 1. Must fix: The cache key ignores the tenant',
      '### 2. Should fix before merge: Cached widgets are never invalidated',
      '### 3. Minor: Typo in the cache log message',
      '## Open questions',
      '## What was checked, and what was not',
      '## Cost',
    ])
  })

  it('gives the verdict, its one reason, and each finding as claim, location and fix', () => {
    const text = explain('full')
    expect(text).toContain(
      'https://github.com/acme/widgets/pull/4 · head 1111111 · This was a full review.',
    )
    expect(text).toContain('Adds an in-memory cache in front of the widget lookup')
    expect(text).toContain(
      '## Verdict: Request Changes\n\nMust fix: The cache key ignores the tenant.',
    )
    expect(text).toContain('Where: `src/cache.mts:42`')
    expect(text).toContain('Where: `src/cache.mts:10-24`')
    expect(text).toContain('> Include the tenant id in the key:\n>\n> ```suggestion')
  })

  it('says what the checks against real data concluded and what a later pull request fixes', () => {
    const text = explain('full')
    expect(text).toContain('The data agrees with this finding. Two tenants requested widget 7')
    expect(text).toContain('The data contradicts this finding, so treat it with care.')
    expect(text).not.toContain('The data agrees with this finding. The logs')
    expect(text).toContain('A later pull request in the stack, #5, already fixes this.')
  })

  it('lists open questions whether they are strings or objects, and drops other shapes', () => {
    const text = explain('full')
    expect(text).toContain(
      '- Should the cache be shared between processes?\n- Who clears it on deploy?\n',
    )
    expect(text).not.toContain('- 7')
  })

  it('says what was not checked: failed and skipped areas, blocked sources, the stack', () => {
    const text = explain('full')
    expect(text).toContain('- Reviewed for: correctness, design.')
    expect(text).toContain(
      '- Not reviewed, security: The run failed twice: timed out after 30 minutes',
    )
    expect(text).toContain('- Not reviewed, history: No history trigger paths changed.')
    expect(text).toContain('- Could not check against metrics: No credentials were configured.')
    expect(text).toContain('- Could not check against tickets\n')
    expect(text).toContain('- Findings were checked against 1 source(s) of real data.')
    expect(text).toContain('- This is pull request 2 of 3 in a stack')
    expect(text).toContain('$3.01 to produce this review.')
  })

  it('uses no process jargon a reader cannot act on', () => {
    expect(explain('full')).not.toMatch(/pillar|verifier|run directory|plan\.json/iu)
  })

  it('explains from review.json alone, deriving the verdict and leaving gaps stated', () => {
    const text = explain('review-only', { repo: 'acme/widgets', pr: 3, title: 'Rename things' })
    expect(headings(text)[0]).toBe('# acme/widgets#3: Rename things')
    expect(text).toContain(
      '## Verdict: Approve\n\nNo blocking or high-severity problem was found.\n\nA small, safe change.',
    )
    expect(text).toContain(
      '### 1. Worth fixing: Name does not match behavior\n\nWhere: `src/a.mts`\n\nThe reviewer gave no further explanation.',
    )
    expect(text).toContain('## Findings (1)')
    expect(text).toContain('No description of the change was recorded.')
    expect(text).toContain('No record of what was checked.')
    expect(text).toContain('Not recorded.')
  })

  it('names the pull request generically when nothing says which it is', () => {
    expect(headings(explain('review-only'))[0]).toBe('# Pull request')
    expect(headings(explain('review-only', { repo: 'acme/widgets', pr: 3, title: null }))[0]).toBe(
      '# acme/widgets#3',
    )
  })

  it('reads the stack and the follow-up mode from stack.json and plan.json when there is no report', () => {
    const text = explain('stack-file')
    expect(headings(text)[0]).toBe('# Pull request: Second step')
    expect(text).toContain(
      'head 2222222 · This was a follow-up review of the changes since the last review.',
    )
    expect(text).toContain('This is pull request 1 of 2 in a stack')
    expect(text).toContain('Its base branch `feature/old` is not the default branch')
    expect(text).toContain('A later pull request in the stack, #7, already fixes this.')
  })

  it('reads evidence, skipped areas and a failed check from report.json alone', () => {
    const text = explain('report-evidence')
    expect(text).toContain('This was a light review, with fewer checks than a full one.')
    expect(text).toContain('## Verdict: Approve')
    expect(text).toContain('- Not reviewed, security: No security trigger paths changed.')
    expect(text).toContain('- The check against real data failed: the run failed twice')
    expect(text).not.toContain('checked against 1 source')
    expect(text).toContain('$0.05 to produce this review.')
  })

  it('leaves the cost out when a report is too thin to total', () => {
    const text = explain('thin')
    expect(text).toContain('## Verdict: not recorded')
    expect(text).toContain('Not recorded.')
  })

  it('says a skipped pull request was not reviewed, and why', () => {
    expect(explain('skipped')).toBe(
      [
        '# acme/widgets#10: Fix README typo',
        'https://github.com/acme/widgets/pull/10 · head 6666666',
        '## Verdict',
        'Nothing was reviewed: Only documentation changed.',
      ].join('\n\n') + '\n',
    )
  })

  it('explains files that leave out most fields without inventing details', () => {
    const text = explain('sparse')
    expect(text).toContain('### 1. Should fix before merge: First claim')
    expect(text).toContain('The reviewer gave no further explanation.')
    expect(text).toContain('Checked against real data: The data agrees with this finding.\n')
    expect(text).not.toContain('The data contradicts')
    expect(text).toContain('- Reviewed for: unknown.')
    expect(text).toContain('- Not reviewed, unknown: no reason recorded')
    expect(text).toContain('- Could not check against unnamed\n')
  })

  it('refuses a directory that holds no review', () => {
    expect(() => explain('nothing-here')).toThrow(/holds no review\.json or report\.json/u)
  })
})

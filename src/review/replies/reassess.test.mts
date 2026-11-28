import { describe, expect, it } from 'vitest'

import type { Judgment } from './judge.mts'
import { parseReplyMarker, replyMarker } from './marker.mts'
import { reassess, replyReviewInput, summaryLine } from './reassess.mts'
import type { ReplyPlan, StandingFinding } from './select.mts'

const standing = (
  thread: string | null,
  severity: StandingFinding['severity'],
  title = `Finding ${thread}`,
): StandingFinding => ({ thread, severity, pillar: 'congruence', title, path: 'a.ts', line: 1 })

const PASSED = { passed: true } as const

const plan = (overrides: Partial<ReplyPlan> = {}): ReplyPlan => ({
  headSha: 'a'.repeat(40),
  reviewedSha: 'a'.repeat(40),
  reviewId: 'R1',
  author: 'dev',
  effort: 'high',
  posted: 'Request Changes',
  questions: [],
  approvalSkipped: false,
  standing: [standing('T1', 'blocking')],
  candidates: [],
  unjudged: [],
  unreadThreads: 0,
  ...overrides,
})

const judged = (
  thread: string,
  outcome: Judgment['outcome'],
  severity: Judgment['severity'] = 'blocking',
): Judgment => ({ thread, outcome, severity, why: 'Because.' })

describe('reply markers', () => {
  it('round-trips a state and a severity', () => {
    expect(parseReplyMarker(`text\n\n${replyMarker('downgraded', 'medium')}`)).toEqual({
      state: 'downgraded',
      severity: 'medium',
    })
    expect(parseReplyMarker(replyMarker('settled'))).toEqual({ state: 'settled' })
    expect(parseReplyMarker('no marker')).toBeUndefined()
  })
})

describe('reassess', () => {
  it('keeps the verdict when an older review thread was not read', () => {
    const unread = plan({ unreadThreads: 2 })
    const result = reassess(unread, [judged('T1', 'settled')], PASSED)
    expect(result).toMatchObject({
      before: 'Request Changes',
      after: 'Request Changes',
      changes: false,
      needsApproval: false,
      refused: expect.stringContaining('2 older review threads were not read'),
    })
    expect(result.remaining).toEqual([])
  })

  it('never changes the verdict or asks for an approval when the head moved', () => {
    const moved = plan({ headSha: 'c'.repeat(40) })
    const result = reassess(moved, [judged('T1', 'settled')], PASSED)
    expect(result).toMatchObject({
      before: 'Request Changes',
      after: 'Request Changes',
      changes: false,
      needsApproval: false,
      refused: expect.stringContaining('follow-up review'),
    })
    expect(result.remaining).toEqual([])
    expect(reassess(moved, [judged('T1', 'settled')]).changes).toBe(false)
  })

  it('settling the only blocking finding lowers Request Changes to Approve once the approval check passed', () => {
    const result = reassess(plan(), [judged('T1', 'settled')], PASSED)
    expect(result).toMatchObject({
      before: 'Request Changes',
      after: 'Approve',
      changes: true,
      needsApproval: true,
      skipped: [],
    })
    expect(result.remaining).toEqual([])
  })

  it('an approval no check passed is never derived: without one it is a Comment that lists the skipped check', () => {
    const unchecked = reassess(plan(), [judged('T1', 'settled')])
    expect(unchecked).toMatchObject({ after: 'Comment', changes: true, needsApproval: true })
    expect(unchecked.skipped.map((skip) => skip.pillar)).toEqual(['approval-check'])
    const refuted = reassess(plan(), [judged('T1', 'settled')], {
      passed: false,
      reason: 'It missed the migration.',
    })
    expect(refuted).toMatchObject({ after: 'Comment', changes: true })
    expect(refuted.skipped).toEqual([
      { pillar: 'approval-check', reason: 'It missed the migration.' },
    ])
  })

  it('moving Request Changes to Comment needs no approval check', () => {
    const result = reassess(plan(), [judged('T1', 'downgraded', 'high')])
    expect(result).toMatchObject({ after: 'Comment', changes: true, needsApproval: false })
  })

  it('a Comment held by a skipped approval check becomes an Approve once the check passes', () => {
    const skipped = plan({ posted: 'Comment', approvalSkipped: true, standing: [] })
    expect(reassess(skipped, [])).toMatchObject({
      after: 'Comment',
      changes: false,
      needsApproval: true,
    })
    expect(reassess(skipped, [], PASSED)).toMatchObject({ after: 'Approve', changes: true })
  })

  it('a blocking finding lowered to medium needs the check for Approve, to high gives Comment', () => {
    expect(reassess(plan(), [judged('T1', 'downgraded', 'medium')], PASSED)).toMatchObject({
      after: 'Approve',
      changes: true,
    })
    expect(reassess(plan(), [judged('T1', 'downgraded', 'high')])).toMatchObject({
      after: 'Comment',
      changes: true,
    })
  })

  it('an open reply changes nothing', () => {
    expect(reassess(plan(), [judged('T1', 'open')])).toMatchObject({
      after: 'Request Changes',
      changes: false,
    })
  })

  it('another blocking finding keeps Request Changes', () => {
    const two = plan({ standing: [standing('T1', 'blocking'), standing('T2', 'blocking')] })
    expect(reassess(two, [judged('T1', 'settled')])).toMatchObject({
      after: 'Request Changes',
      changes: false,
    })
  })

  it('open questions and a skipped approval check keep an approve at Comment', () => {
    const question = { question: 'q?', askOf: 'author', why: 'w' } as const
    expect(
      reassess(plan({ questions: [question] }), [judged('T1', 'settled')], PASSED),
    ).toMatchObject({ after: 'Comment', changes: true, needsApproval: false })
    const skipped = plan({ posted: 'Comment', approvalSkipped: true, standing: [] })
    expect(reassess(skipped, [])).toMatchObject({ after: 'Comment', changes: false })
  })

  it('never raises a verdict', () => {
    const approved = plan({ posted: 'Approve', standing: [standing('T1', 'blocking')] })
    const result = reassess(approved, [judged('T1', 'open')])
    expect(result.changes).toBe(false)
    expect(result.refused).toBeUndefined()
  })

  it('refuses a change when the posted verdict was not derived from these findings', () => {
    const odd = plan({ posted: 'Request Changes', standing: [standing('T1', 'high')] })
    const result = reassess(odd, [judged('T1', 'settled')], PASSED)
    expect(result.changes).toBe(false)
    expect(result.refused).toContain('full review')
  })

  it('a finding with no path or line still counts', () => {
    const bare = plan({ standing: [{ ...standing('T1', 'blocking'), path: null, line: null }] })
    expect(reassess(bare, [judged('T1', 'open')]).after).toBe('Request Changes')
  })

  it('a body finding without a thread stays standing', () => {
    const body = plan({ standing: [standing(null, 'blocking')] })
    expect(reassess(body, []).remaining).toHaveLength(1)
  })
})

describe('the review for the same head', () => {
  it('lists the replies that moved it and keeps remaining findings, standing only when threaded', () => {
    const base = plan({
      standing: [
        standing('T1', 'blocking', 'One'),
        standing('T2', 'high', 'Two'),
        standing(null, 'low', 'Body'),
      ],
      posted: 'Request Changes',
    })
    const judgments = [
      judged('T1', 'settled'),
      judged('T2', 'downgraded', 'medium'),
      judged('T3', 'open'),
    ]
    const result = reassess(base, judgments)
    const input = replyReviewInput(base, result, judgments)
    expect(input.summary).toBe(
      'Re-assessed after the author\'s replies: settled "One"; lowered "Two" to medium.',
    )
    expect(
      input.findings.map((finding) => [
        finding.title,
        finding.severity,
        (finding as { standing?: true }).standing,
      ]),
    ).toEqual([
      ['Two', 'medium', true],
      ['Body', 'low', undefined],
    ])
    expect(input.effort).toBe('high')
  })

  it('falls back to the default effort and names a finding it cannot find', () => {
    const base = plan({ effort: 'bogus', posted: 'Request Changes' })
    const judgments = [judged('GONE', 'settled')]
    expect(summaryLine(judgments, base)).toContain('"a finding"')
    expect(replyReviewInput(base, reassess(base, judgments), judgments).effort).toBeDefined()
  })

  it('records a skipped approval check so the verdict stays a Comment', () => {
    const base = plan({ approvalSkipped: true, posted: 'Request Changes' })
    const judgments = [judged('T1', 'settled')]
    const input = replyReviewInput(base, reassess(base, judgments), judgments)
    expect(input.skipped).toHaveLength(1)
  })
})

describe('the review id', () => {
  it('is the same for the same judgments and differs when they differ', () => {
    const base = plan()
    const settled = [judged('T1', 'settled')]
    const first = replyReviewInput(base, reassess(base, settled), settled)
    const again = replyReviewInput(base, reassess(base, settled), settled)
    const lowered = [judged('T1', 'downgraded', 'medium')]
    const other = replyReviewInput(base, reassess(base, lowered), lowered)
    expect(first.reviewId).toBe(again.reviewId)
    expect(first.reviewId).not.toBe(other.reviewId)
    expect(first.reviewId).toMatch(/^[A-Za-z0-9_-]{8,64}$/u)
  })
})

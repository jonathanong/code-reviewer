import { describe, expect, it } from 'vitest'

import type { ApprovalCheck } from './approval-check.mts'
import { renderApprovalCheck } from './approval-check-render.mts'

const base: ApprovalCheck = {
  model: 'opus',
  outcome: 'upheld',
  verdictBefore: 'Approve',
  verdictAfter: 'Approve',
  note: '',
  findings: [],
  questions: [],
  usage: null,
}
const finding = { pillar: 'rules' as const, severity: 'low' as const, title: 't', body: 'b' }

describe('renderApprovalCheck', () => {
  it('renders nothing when the review got no second check', () => {
    expect(renderApprovalCheck(undefined)).toEqual([])
  })

  it('says the approval stands, with counts and the note', () => {
    expect(renderApprovalCheck({ ...base, note: 'Read the migration.' })).toEqual([
      '### Second check on the approval\n\nRan (opus), added 0 findings and 0 questions; the approval stands.\n\nRead the migration.',
    ])
  })

  it('says what it added and how the verdict changed', () => {
    const changed: ApprovalCheck = {
      ...base,
      outcome: 'changed',
      verdictAfter: 'Comment',
      findings: [finding],
      questions: [{ question: 'Q?', askOf: 'author', why: 'W' }],
    }
    expect(renderApprovalCheck(changed)).toEqual([
      '### Second check on the approval\n\nRan (opus), added 1 finding and 1 question; the verdict changed from Approve to Comment.',
    ])
  })

  it('says a failed check made the verdict a Comment, with or without an error text', () => {
    const failed: ApprovalCheck = { ...base, outcome: 'failed', verdictAfter: 'Comment' }
    expect(renderApprovalCheck({ ...failed, error: 'timed out' })[0]).toContain(
      'Did not complete (timed out). It is listed as skipped, so the verdict is Comment, not Approve.',
    )
    expect(renderApprovalCheck(failed)[0]).toContain('Did not complete (no reason recorded)')
  })
})

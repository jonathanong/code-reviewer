import { createHash } from 'node:crypto'

import type { Standing } from '../build.mts'
import {
  EFFORTS,
  DEFAULT_EFFORT,
  type Finding,
  type ReviewInput,
  type SkippedPillar,
} from '../finding.mts'
import type { Pillar } from '../pillar-name.mts'
import { deriveVerdict, type Verdict } from '../render.mts'
import { APPROVAL_CHECK } from '../skipped.mts'
import type { Judgment } from './judge.mts'
import { headMoved, type ReplyPlan, type StandingFinding } from './select.mts'

const STRICTNESS: readonly Verdict[] = ['Approve', 'Comment', 'Request Changes']

export const asFinding = (item: StandingFinding): Finding & Standing => ({
  // The pillar and title come from the head of this reviewer's own earlier comment.
  pillar: item.pillar as Pillar,
  severity: item.severity,
  title: item.title,
  body: 'Still open from the earlier review.',
  ...(item.path === null ? {} : { path: item.path }),
  ...(item.line === null ? {} : { line: item.line }),
  // A threaded finding is already in its thread; only a body finding is written into the body again.
  ...(item.thread === null ? {} : { standing: true as const }),
})

/** The same replies judged the same way on the same head give the same id, so a repeated run cannot post twice. */
function reviewIdFor(plan: ReplyPlan, judgments: readonly Judgment[]): string {
  const basis = JSON.stringify([
    plan.headSha,
    judgments.map(({ thread, outcome, severity }) => [thread, outcome, severity]),
  ])
  return `replies-${createHash('sha256').update(basis).digest('hex').slice(0, 32)}`
}

/** What the second check on an approval said; absent when none was run. */
export type Approval = { passed: true } | { passed: false; reason: string }

export type Reassessment = {
  before: Verdict
  after: Verdict
  /** Moving to Approve is possible only once the approval check passes; code never posts one without it. */
  needsApproval: boolean
  /** The review's own skipped list: the approval check listed here keeps the verdict a Comment. */
  skipped: SkippedPillar[]
  /** The findings still open once the judgments are applied, at their severities then. */
  remaining: StandingFinding[]
  /** Why a changed verdict is not applied; undefined when it may be, or when it did not change. */
  refused?: string
  /** True when the new verdict is strictly less strict than the posted one and may be posted. */
  changes: boolean
}

const NOT_RUN =
  'The second check on the approval was not run for this re-assessment, so this is a comment, not an approval.'

function approvalSkips(approval: Approval): SkippedPillar[] {
  return approval.passed ? [] : [{ pillar: APPROVAL_CHECK, reason: approval.reason }]
}

function skippedOf(plan: ReplyPlan): SkippedPillar[] {
  return plan.approvalSkipped
    ? [{ pillar: APPROVAL_CHECK, reason: 'The second check on the approval did not complete.' }]
    : []
}

/**
 * Derives the verdict again from the findings that remain, with the verifier's rules
 * (`deriveVerdict`). It never raises a verdict: it changes only when the verdict derived from the
 * findings as they stood equals the posted one, which shows nothing outside these findings (an
 * approval-check skip, a thread resolved since) lowered it, and the new one is strictly lower.
 * `needsApproval` says the findings alone would give an Approve; the caller runs the approval check
 * and calls again with its `approval`. Without a passed check an Approve is never derived: the
 * approval check counts as skipped, which makes the verdict a Comment.
 */
export function reassess(
  plan: ReplyPlan,
  judgments: readonly Judgment[],
  approval?: Approval,
): Reassessment {
  const byThread = new Map(judgments.map((judgment) => [judgment.thread, judgment]))
  const remaining = plan.standing.flatMap((item): StandingFinding[] => {
    const judged = item.thread === null ? undefined : byThread.get(item.thread)
    if (judged?.outcome === 'settled') return []
    return [judged?.outcome === 'downgraded' ? { ...item, severity: judged.severity } : item]
  })
  if (headMoved(plan)) {
    // The commits since the review were not reviewed as a whole, so no verdict, approval or label
    // may follow from replies about them; the threads alone are answered.
    return {
      before: plan.posted,
      after: plan.posted,
      needsApproval: false,
      skipped: skippedOf(plan),
      remaining,
      changes: false,
      refused: `the head moved since the review (${plan.reviewedSha.slice(0, 12)}), so only a follow-up review gives a verdict on the new head`,
    }
  }
  const before = deriveVerdict(plan.standing.map(asFinding), plan.questions, skippedOf(plan))
  const findings = remaining.map(asFinding)
  const unchecked = deriveVerdict(findings, plan.questions, [])
  const lower = (verdict: Verdict) => STRICTNESS.indexOf(verdict) < STRICTNESS.indexOf(plan.posted)
  const needsApproval = unchecked === 'Approve' && lower(unchecked) && before === plan.posted
  const given =
    approval ?? (needsApproval ? { passed: false as const, reason: NOT_RUN } : undefined)
  const skipped = given === undefined ? skippedOf(plan) : approvalSkips(given)
  const after = deriveVerdict(findings, plan.questions, skipped)
  const base = { before, after, needsApproval, skipped, remaining }
  if (!lower(after)) return { ...base, changes: false }
  if (before !== plan.posted) {
    return {
      ...base,
      changes: false,
      refused: `the findings still open give ${before}, not the posted ${plan.posted}, so something outside them shaped that verdict; a full review should re-assess it`,
    }
  }
  return { ...base, changes: true }
}

/** What the new review of the same head says: the replies that moved it. */
export function summaryLine(judgments: readonly Judgment[], plan: ReplyPlan): string {
  const titles = new Map(plan.standing.map((item) => [item.thread, item.title]))
  const parts = judgments.flatMap((judgment) => {
    const title = titles.get(judgment.thread) ?? 'a finding'
    if (judgment.outcome === 'settled') return [`settled "${title}"`]
    if (judgment.outcome === 'downgraded') return [`lowered "${title}" to ${judgment.severity}`]
    return []
  })
  return `Re-assessed after the author's replies: ${parts.join('; ')}.`
}

/**
 * The review input for the same head with the remaining findings. Threaded findings stay in their
 * threads (see `Standing`); body findings and questions are written again so the next
 * review, which reads the newest review of the head, still finds them.
 */
export function replyReviewInput(
  plan: ReplyPlan,
  result: Reassessment,
  judgments: readonly Judgment[],
): ReviewInput {
  const effort = EFFORTS.find((candidate) => candidate === plan.effort) ?? DEFAULT_EFFORT
  return {
    reviewId: reviewIdFor(plan, judgments),
    effort,
    summary: summaryLine(judgments, plan),
    skipped: result.skipped,
    findings: result.remaining.map(asFinding),
    questions: plan.questions,
  }
}

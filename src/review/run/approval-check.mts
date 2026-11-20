import type { Exec } from '../benchmark/exec.mts'
import { describeFailure, type Usage } from '../benchmark/usage.mts'
import { ReviewError, parseReviewInput } from '../finding.mts'
import type { Finding, SkippedPillar } from '../finding.mts'
import type { Question } from '../question.mts'
import { deriveVerdict, type Verdict } from '../render.mts'
import { APPROVAL_CHECK } from '../skipped.mts'
import {
  APPROVAL_CHECK_SCHEMA,
  buildApprovalCheckPrompt,
  type ApprovalCheckInput,
} from './approval-check-prompt.mts'
import { CLAUDE_EFFORT, SKILL_TOOLS, pillarArgs } from './claude-flags.mts'
import { readStream } from './stream-output.mts'
import { REVIEW_MAX_TURNS, RUN_TIMEOUT_MS } from './types.mts'

/** What the check did, saved as `approval-check.json` and shown in the report. */
export type ApprovalCheck = {
  model: string
  /** `upheld`: the verdict stayed Approve. `changed`: it did not. `failed`: the run did not finish. */
  outcome: 'upheld' | 'changed' | 'failed'
  verdictBefore: Verdict
  verdictAfter: Verdict
  /** One line on what the check looked at and why the approval stands or not. */
  note: string
  /** Findings and questions the check added to the review. */
  findings: Finding[]
  questions: Question[]
  usage: Usage | null
  error?: string
}

type Run = { findings: Finding[]; questions: Question[]; note: string; usage: Usage }

/** Reads the check's stream; malformed findings or questions fail the check, not the review. */
export function parseApprovalCheck(stdout: string): Run {
  const { structured, usage } = readStream(stdout, 'Approval check run')
  const raw = structured as { summary?: unknown; findings?: unknown; questions?: unknown } | null
  if (raw === null || raw === undefined || !Array.isArray(raw.findings)) {
    throw new ReviewError('Approval check run returned no structured findings.')
  }
  const review = parseReviewInput({
    summary: raw.summary,
    findings: raw.findings,
    questions: raw.questions,
  })
  return { findings: review.findings, questions: review.questions, note: review.summary, usage }
}

export type ApprovalCheckStep = {
  /** False when the settings switch the check off. */
  enabled: boolean
  mode: 'light' | 'full'
  model: string
  tree: string
  settings?: object
  exec: Exec
  input: ApprovalCheckInput
}

export type ApprovalCheckResult = {
  /** Absent when the check did not apply: it is off, the review is light, or the verdict is not Approve. */
  check?: ApprovalCheck
  findings: Finding[]
  questions: Question[]
  skipped: SkippedPillar[]
}

const firstLine = (text: string) => text.split('\n')[0] as string

/**
 * The second check on an approval. When a full review would approve, one independent run tries to
 * refute the approval; what it confirms is added to the findings and questions, and the verdict is
 * derived again by `deriveVerdict`. A run that fails is listed under `skipped`, which makes the
 * verdict Comment: an approval nothing double-checked is not given. It never throws and is never
 * retried, so it costs at most one run.
 */
export async function applyApprovalCheck(step: ApprovalCheckStep): Promise<ApprovalCheckResult> {
  const { input } = step
  const base = {
    findings: [...input.findings],
    questions: [...input.questions],
    skipped: [...input.skipped],
  }
  const before = deriveVerdict(base.findings, base.questions, base.skipped)
  if (!step.enabled || step.mode !== 'full' || before !== 'Approve') return base
  const args = pillarArgs({
    prompt: buildApprovalCheckPrompt(input),
    model: step.model,
    maxTurns: REVIEW_MAX_TURNS,
    tools: SKILL_TOOLS,
    effort: CLAUDE_EFFORT.full,
    schema: APPROVAL_CHECK_SCHEMA,
    explorer: false,
    addDirs: [input.run.out, input.references],
    ...(step.settings === undefined ? {} : { settings: step.settings }),
  })
  try {
    const run = parseApprovalCheck(
      await step.exec('claude', args, { cwd: step.tree, timeoutMs: RUN_TIMEOUT_MS }),
    )
    const findings = [...base.findings, ...run.findings]
    const questions = [...base.questions, ...run.questions]
    const after = deriveVerdict(findings, questions, base.skipped)
    const check: ApprovalCheck = {
      model: step.model,
      outcome: after === 'Approve' ? 'upheld' : 'changed',
      verdictBefore: before,
      verdictAfter: after,
      note: run.note,
      findings: run.findings,
      questions: run.questions,
      usage: run.usage,
    }
    return { check, findings, questions, skipped: base.skipped }
  } catch (error) {
    const { message, usage } = describeFailure(error)
    const reason = `The second check on the approval did not complete (${firstLine(message).slice(0, 160)}), so this is a comment, not an approval.`
    const skipped: SkippedPillar[] = [...base.skipped, { pillar: APPROVAL_CHECK, reason }]
    const check: ApprovalCheck = {
      model: step.model,
      outcome: 'failed',
      verdictBefore: before,
      verdictAfter: deriveVerdict(base.findings, base.questions, skipped),
      note: '',
      findings: [],
      questions: [],
      usage,
      error: firstLine(message),
    }
    return { check, findings: base.findings, questions: base.questions, skipped }
  }
}

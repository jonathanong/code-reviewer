import { describeStepFailure, type StepRan } from '../../harness/runner.mts'
import { EFFORT, type HarnessResult } from '../../harness/types.mts'
import type { Exec } from '../benchmark/exec.mts'
import type { Usage } from '../benchmark/usage.mts'
import { DEFAULT_STEP_MODELS, runModelStep, tierOfPlanned, type StepModels } from '../models.mts'
import type { Model } from '../plan.mts'
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
import { withExtraPillars } from './extra-pillar-schema.mts'
import { SKILL_READER } from './pillar-capabilities.mts'
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
  ran?: StepRan
}

type Run = {
  findings: Finding[]
  questions: Question[]
  note: string
  /** The review's summary rewritten for the additions; absent when the check gave none. */
  reviewSummary?: string
  usage: Usage
}

/** Reads the check's answer; malformed findings or questions fail the check, not the review. */
export function parseApprovalCheck({ structured, usage }: HarnessResult): Run {
  const raw = structured as {
    summary?: unknown
    reviewSummary?: unknown
    findings?: unknown
    questions?: unknown
  } | null
  if (raw === null || raw === undefined || !Array.isArray(raw.findings)) {
    throw new ReviewError('Approval check run returned no structured findings.')
  }
  const review = parseReviewInput({
    summary: raw.summary,
    findings: raw.findings,
    questions: raw.questions,
  })
  const rewritten = typeof raw.reviewSummary === 'string' ? raw.reviewSummary.trim() : ''
  return {
    findings: review.findings,
    questions: review.questions,
    note: review.summary,
    ...(rewritten === '' ? {} : { reviewSummary: rewritten }),
    usage,
  }
}

export type ApprovalCheckStep = {
  /** False when the settings switch the check off. */
  enabled: boolean
  mode: 'light' | 'full'
  /** The planned model; it names the tier the check runs on unless the models config sets the step. */
  model: Model
  tree: string
  /** Names of the configured pillars, so their findings pass the output schema. */
  extraPillars?: readonly string[]
  settings?: object
  models?: StepModels
  exec: Exec
  input: ApprovalCheckInput
}

export type ApprovalCheckResult = {
  /** Absent when the check did not apply: it is off, the review is light, or the verdict is not Approve. */
  check?: ApprovalCheck
  findings: Finding[]
  questions: Question[]
  skipped: SkippedPillar[]
  /** The review's summary to post instead of the verifier's: set only when the check added something and rewrote it. */
  summary?: string
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
  // Set once the model has answered, so an answer that fails to parse still names who gave it.
  let ran: StepRan | undefined
  try {
    const answered = await runModelStep(
      step.models ?? DEFAULT_STEP_MODELS,
      { keys: ['approvalCheck'], fallback: tierOfPlanned(step.model) },
      {
        prompt: buildApprovalCheckPrompt(input),
        label: 'Approval check run',
        maxTurns: REVIEW_MAX_TURNS,
        schema: withExtraPillars(APPROVAL_CHECK_SCHEMA, step.extraPillars ?? []),
        can: SKILL_READER,
        cwd: step.tree,
        timeoutMs: RUN_TIMEOUT_MS,
        effort: EFFORT.full,
        addDirs: [input.run.out, input.references],
        transcript: true,
        ...(step.settings === undefined ? {} : { settings: step.settings }),
      },
      step.exec,
    )
    ran = answered.ran
    const run = parseApprovalCheck(answered)
    const findings = [...base.findings, ...run.findings]
    const questions = [...base.questions, ...run.questions]
    const after = deriveVerdict(findings, questions, base.skipped)
    const check: ApprovalCheck = {
      model: answered.ran.model,
      ran: answered.ran,
      outcome: after === 'Approve' ? 'upheld' : 'changed',
      verdictBefore: before,
      verdictAfter: after,
      note: run.note,
      findings: run.findings,
      questions: run.questions,
      usage: run.usage,
    }
    const added = run.findings.length + run.questions.length > 0
    const summary = added ? run.reviewSummary : undefined
    return {
      check,
      findings,
      questions,
      skipped: base.skipped,
      ...(summary === undefined ? {} : { summary }),
    }
  } catch (error) {
    const { message, usage, ran: failedRun } = describeStepFailure(error)
    ran = failedRun ?? ran
    const reason = `The second check on the approval did not complete (${firstLine(message).slice(0, 160)}), so this is a comment, not an approval.`
    const skipped: SkippedPillar[] = [...base.skipped, { pillar: APPROVAL_CHECK, reason }]
    const check: ApprovalCheck = {
      model: ran?.model ?? step.model,
      ...(ran === undefined ? {} : { ran }),
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

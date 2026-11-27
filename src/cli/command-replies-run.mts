import type { PullTarget } from '../review/index.mts'
import type { StepModels } from '../review/models.mts'
import { judgeReplies, type Judgment } from '../review/replies/judge.mts'
import { reassess } from '../review/replies/reassess.mts'
import type { RepliesRecord } from '../review/replies/report.mts'
import { newestOwnReview, type ReplyPlan } from '../review/replies/select.mts'
import { RUN_EXIT } from '../run/output.mts'
import type { RunEnv } from '../run/command.mts'
import { runDirFor } from '../run/stage.mts'
import { approveReplies, type ApprovalRun } from './command-replies-approve.mts'
import { line, type RepliesLine } from './command-replies-line.mts'
import { applyWrites, recordCost } from './command-replies-write.mts'
import type { ReviewDeps } from './deps.mts'

export type Assessment = {
  deps: ReviewDeps
  pull: PullTarget
  plan: ReplyPlan
  trusted: ReadonlySet<string>
  models: StepModels
  /** The breaking-change rule the judging call quotes. */
  rule: string
  env: RunEnv
  title: string
  /** Why nothing may be written; empty when this run writes. */
  held: string[]
}

const total = (...costs: Array<number | null | undefined>): number | null => {
  const known = costs.filter((cost): cost is number => typeof cost === 'number')
  return known.length === 0 ? null : known.reduce((sum, cost) => sum + cost, 0)
}

/** Why the writes must not go ahead any more: the head moved, or another run's review landed. */
async function moved(run: Assessment): Promise<string | undefined> {
  const { deps, pull, plan, trusted } = run
  if ((await deps.createIo(pull).headSha()) !== plan.headSha) {
    return 'the head moved while the replies were judged; a follow-up review reads them'
  }
  const now = await deps.createAnswerIo(pull).conversation()
  return newestOwnReview(now, trusted) === plan.reviewId
    ? undefined
    : 'a newer review by this reviewer landed while the replies were judged; run replies again'
}

/**
 * Judges the author's replies, derives the verdict again, and either holds the result or writes
 * it: the approval check when the verdict would become an Approve, then, once the head and the
 * newest review are checked again, the review, the thread replies and the resolved threads.
 */
export async function assessReplies(run: Assessment): Promise<RepliesLine> {
  const { deps, pull, plan, held } = run
  const base = { repo: pull.repo, pr: pull.pr }
  const judged = await judgeReplies(plan.candidates, run.rule, {
    models: run.models,
    exec: deps.exec,
    cwd: run.env.tmp,
  })
  const where = { ...base, headSha: plan.headSha, costUsd: judged.usage?.costUsd ?? null }
  if (judged.error !== undefined) {
    return line({
      ...where,
      outcome: 'error',
      exitCode: RUN_EXIT.failed,
      reason: `the replies step failed, so nothing was written: ${judged.error}`,
    })
  }
  // The report belongs to the head that was reviewed, which is where the cost is added.
  const runDir = runDirFor(deps, pull.repo, pull.pr, plan.reviewedSha)
  let result = reassess(plan, judged.judgments)
  let approval: ApprovalRun | undefined
  if (result.needsApproval && held.length === 0) {
    approval = await approveReplies(deps, pull, plan, judged.judgments, result, {
      title: run.title,
      runDir,
      models: run.models,
      env: run.env,
    })
    result = reassess(plan, judged.judgments, approval.approval)
  }
  const costUsd = total(where.costUsd, approval?.usage?.costUsd)
  const count = (outcome: Judgment['outcome']) =>
    judged.judgments.filter((judgment) => judgment.outcome === outcome).length
  const verdictAfter = result.changes ? result.after : plan.posted
  const record: RepliesRecord = {
    at: deps.tracker().now().toISOString(),
    settled: count('settled'),
    downgraded: count('downgraded'),
    open: count('open'),
    verdictBefore: plan.posted,
    verdictAfter,
    posted: false,
    ...(approval?.outcome === undefined ? {} : { approval: approval.outcome }),
    costUsd,
  }
  const notes = [
    ...(result.refused === undefined ? [] : [`the verdict was kept: ${result.refused}`]),
    ...(approval?.notes ?? []),
    ...(result.needsApproval && approval === undefined
      ? ['an Approve needs the approval check, which runs when this is applied']
      : []),
  ]
  const summary = {
    ...where,
    costUsd,
    verdictBefore: plan.posted,
    verdictAfter,
    judged: judged.judgments.map(({ thread, outcome, severity, why }) => ({
      thread,
      outcome,
      severity,
      why,
    })),
    unjudged: plan.unjudged,
  }
  if (held.length > 0) {
    const problem = recordCost(deps, runDir, record, judged)
    return line({
      ...summary,
      outcome: 'held',
      exitCode: RUN_EXIT.held,
      reason: 'nothing was written',
      attention: [...held, ...notes, ...(problem === undefined ? [] : [problem])],
      applyCommand: `code-reviewer replies --repo ${pull.repo} --pr ${pull.pr}`,
    })
  }
  const stale = await moved(run)
  if (stale !== undefined) {
    const problem = recordCost(deps, runDir, record, judged, approval)
    return line({
      ...where,
      costUsd,
      reason: stale,
      attention: [...notes, ...(problem === undefined ? [] : [problem])],
    })
  }
  const written = await applyWrites(deps, pull, plan, judged.judgments, result)
  const problem = recordCost(
    deps,
    runDir,
    { ...record, posted: written.review !== undefined },
    judged,
    approval,
  )
  return line({
    ...summary,
    outcome: 'applied',
    exitCode: RUN_EXIT.posted,
    reviewUrl: written.review?.url ?? null,
    event: written.review?.event ?? null,
    replied: written.replied,
    resolved: written.resolved,
    attention: [...notes, ...written.problems, ...(problem === undefined ? [] : [problem])],
  })
}

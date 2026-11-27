import { resolveRun } from '../review/index.mts'
import { parseModelOverrides } from '../review/model-overrides.mts'
import { resolveModels } from '../review/models-settings.mts'
import { judgeReplies, breakingChangeRule, type Judgment } from '../review/replies/judge.mts'
import { reassess } from '../review/replies/reassess.mts'
import type { RepliesRecord } from '../review/replies/report.mts'
import { planReplies } from '../review/replies/select.mts'
import { RUN_EXIT, type RunExit } from '../run/output.mts'
import { checkPreconditions, parseFlags, Precondition } from '../run/preflight.mts'
import { defaultRunEnv, type RunEnv } from '../run/command.mts'
import { runDirFor } from '../run/stage.mts'
import { line, type RepliesLine } from './command-replies-line.mts'
import { applyWrites, message, recordCost } from './command-replies-write.mts'
import type { ReviewDeps } from './deps.mts'
import { labelsFor } from './review-settings.mts'

export type RepliesValues = {
  repo?: string[] | undefined
  pr?: string | undefined
  post?: string | undefined
  model?: string[] | undefined
}

/**
 * `code-reviewer replies`: re-assesses this reviewer's newest review of a pull request from the
 * author's new replies on its unresolved threads, in one model call with no tools. Settled findings
 * leave the findings, lowered ones keep a lower severity, and the verdict is derived again; a
 * lower verdict goes out as a new review of the same head. A pull request whose head moved since
 * that review is left to a follow-up review.
 */
export async function repliesCommand(
  values: RepliesValues,
  deps: ReviewDeps,
  env: RunEnv = defaultRunEnv(),
): Promise<RepliesLine> {
  const { pull, post } = parseFlags(values)
  const base = { repo: pull.repo, pr: pull.pr }
  await checkPreconditions(deps, pull.repo)
  const io = deps.createIo(pull)
  const trusted = await io.trustedAuthors()
  if (trusted.size === 0) throw new Precondition('the reviewer identity is unknown.')
  const names = await labelsFor(deps, pull.repo)
  const labels = await deps.createLabelIo(pull).labels()
  const busy = [names.requested, names.processing, names.held].filter((name) =>
    labels.includes(name),
  )
  if (busy.length > 0) {
    return line({
      ...base,
      reason: `the pull request carries ${busy.join(', ')}; a review reads the replies itself`,
    })
  }
  const conversation = await deps.createAnswerIo(pull).conversation()
  const plan = planReplies(conversation, trusted)
  if ('noop' in plan) return line({ ...base, reason: plan.noop })
  const rule = breakingChangeRule(deps.references())
  if (rule === undefined) {
    throw new Precondition('the breaking-change rule is no longer in verifier.md.')
  }
  const models = resolveModels(deps.configs(), pull.repo, parseModelOverrides(values.model ?? []))
  const judged = await judgeReplies(plan.candidates, rule, {
    models: { plan: models.plan },
    exec: deps.exec,
    cwd: env.tmp,
  })
  const costUsd = judged.usage?.costUsd ?? null
  const where = { ...base, headSha: plan.headSha, costUsd }
  if (judged.error !== undefined) {
    return line({
      ...where,
      outcome: 'error',
      exitCode: RUN_EXIT.failed,
      reason: `the replies step failed, so nothing was written: ${judged.error}`,
    })
  }
  const result = reassess(plan, judged.judgments)
  const count = (outcome: Judgment['outcome']) =>
    judged.judgments.filter((judgment) => judgment.outcome === outcome).length
  const record: RepliesRecord = {
    at: deps.tracker().now().toISOString(),
    settled: count('settled'),
    downgraded: count('downgraded'),
    open: count('open'),
    verdictBefore: plan.posted,
    verdictAfter: result.changes ? result.after : plan.posted,
    posted: false,
    costUsd,
  }
  const runDir = runDirFor(deps, pull.repo, pull.pr, plan.headSha)
  const summary = {
    ...where,
    verdictBefore: plan.posted,
    verdictAfter: result.changes ? result.after : plan.posted,
    judged: judged.judgments.map(({ thread, outcome, severity, why }) => ({
      thread,
      outcome,
      severity,
      why,
    })),
    unjudged: plan.unjudged,
  }
  const notes = result.refused === undefined ? [] : [`the verdict was kept: ${result.refused}`]
  const identity =
    deps.authMode() !== 'app' && resolveRun(deps.configs(), pull.repo).rules['not-app-identity']
      ? ['calls use the local gh login, not the GitHub App']
      : []
  const held = [...(post === 'hold' ? ['--post hold'] : []), ...identity]
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
  if ((await io.headSha()) !== plan.headSha) {
    const problem = recordCost(deps, runDir, record, judged)
    return line({
      ...where,
      reason: 'the head moved while the replies were judged; a follow-up review reads them',
      attention: problem === undefined ? [] : [problem],
    })
  }
  const written = await applyWrites(deps, pull, plan, judged.judgments, result)
  const problem = recordCost(
    deps,
    runDir,
    { ...record, posted: written.review !== undefined },
    judged,
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

/** Runs `repliesCommand`, prints its line, and turns a failure into an error line with an exit code. */
export async function runRepliesCommand(values: RepliesValues, deps: ReviewDeps): Promise<RunExit> {
  let result: RepliesLine
  try {
    result = await repliesCommand(values, deps)
  } catch (error) {
    const code = error instanceof Precondition ? RUN_EXIT.precondition : RUN_EXIT.failed
    result = line({ outcome: 'error', exitCode: code, reason: message(error) })
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result.exitCode
}

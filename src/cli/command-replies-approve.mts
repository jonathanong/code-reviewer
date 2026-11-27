import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { StepRan } from '../harness/runner.mts'
import type { Usage } from '../review/benchmark/usage.mts'
import { resolveRulePlugins } from '../review/grant-settings.mts'
import { resolveApprovalCheck, type PullTarget } from '../review/index.mts'
import type { StepModels } from '../review/models.mts'
import type { Judgment } from '../review/replies/judge.mts'
import {
  asFinding,
  summaryLine,
  type Approval,
  type Reassessment,
} from '../review/replies/reassess.mts'
import type { ReplyPlan } from '../review/replies/select.mts'
import { applyApprovalCheck, type ApprovalCheck } from '../review/run/approval-check.mts'
import { runDir as preparedRunDir } from '../review/run/review-support.mts'
import { defaultRunEnv, type RunEnv } from '../run/command.mts'
import { checkoutHead, type Tree } from '../run/tree.mts'
import { prepareCommand } from './command-loop.mts'
import { message } from './command-replies-write.mts'
import { requireValidConfig } from './config-check.mts'
import type { ReviewDeps } from './deps.mts'

/** What the second check on an approval said about a re-assessment that would approve. */
export type ApprovalRun = {
  approval: Approval
  /** Absent when the machine config switched the check off. */
  outcome: 'upheld' | 'not upheld' | undefined
  usage: Usage | null
  ran: StepRan | undefined
  /** What a person should read: why the approval was not given, or a problem with the checkout. */
  notes: string[]
}

const PASSED: ApprovalRun = {
  approval: { passed: true },
  outcome: undefined,
  usage: null,
  ran: undefined,
  notes: [],
}

function refused(reason: string, check?: ApprovalCheck): ApprovalRun {
  return {
    approval: { passed: false, reason: `${reason}, so this is a comment, not an approval.` },
    outcome: 'not upheld',
    usage: check?.usage ?? null,
    ran: check?.ran,
    notes: [reason],
  }
}

type Where = { title: string; runDir: string; models: StepModels; clones: string | undefined }

async function check(
  deps: ReviewDeps,
  pull: PullTarget,
  plan: ReplyPlan,
  judgments: readonly Judgment[],
  result: Reassessment,
  where: Where & { tree: Tree },
): Promise<ApprovalRun> {
  const out = join(where.runDir, 'replies-approval')
  const references = deps.references()
  const own = (await requireValidConfig(deps, pull.repo)).config
  await prepareCommand(
    { out, tree: where.tree.path, ...(where.clones === undefined ? {} : { clones: where.clones }) },
    () => pull,
    deps,
  )
  // What the replies removed goes to the check as findings the verifier dropped, to challenge.
  const dropped = judgments.flatMap((judgment) => {
    const item = plan.standing.find((standing) => standing.thread === judgment.thread)
    return judgment.outcome === 'open' || item === undefined
      ? []
      : [{ finding: asFinding(item), reason: `${judgment.outcome} by the author: ${judgment.why}` }]
  })
  const checked = await applyApprovalCheck({
    enabled: true,
    mode: 'full',
    model: 'opus',
    tree: where.tree.path,
    models: where.models,
    exec: deps.exec,
    input: {
      prompt: readFileSync(join(references, 'refute.md'), 'utf8'),
      references,
      run: preparedRunDir(out, null, resolveRulePlugins(deps.configs(), pull.repo, own).names),
      pullRequestSummary: where.title,
      summary: summaryLine(judgments, plan),
      findings: result.remaining.map(asFinding),
      questions: plan.questions,
      skipped: [],
      ran: [],
      dropped,
    },
  })
  // `needsApproval` means the findings give an Approve, so the check ran.
  const done = checked.check as ApprovalCheck
  if (done.outcome === 'upheld') {
    return { ...PASSED, outcome: 'upheld', usage: done.usage, ran: done.ran }
  }
  return refused(
    done.outcome === 'failed'
      ? `the approval check could not run: ${done.error}`
      : `the approval check did not uphold the approval: ${done.note}`,
    done,
  )
}

/**
 * Runs the approval check the way `run` does, on the head checked out the way `run` checks it out,
 * with the findings that remain and the ones the replies removed. A check the machine config
 * switched off passes, as for `run`. One that refutes the approval or cannot run gives the highest
 * verdict that does not need it, which is a Comment.
 */
export async function approveReplies(
  deps: ReviewDeps,
  pull: PullTarget,
  plan: ReplyPlan,
  judgments: readonly Judgment[],
  result: Reassessment,
  where: Omit<Where, 'clones'> & { env?: RunEnv },
): Promise<ApprovalRun> {
  if (!resolveApprovalCheck(deps.configs(), pull.repo).enabled) return PASSED
  const env = where.env ?? defaultRunEnv()
  const root = env.env.CODE_REVIEWER_CLONE_ROOT
  const clones = root === undefined ? undefined : resolve(root)
  let tree: Tree
  try {
    tree = await checkoutHead({
      repo: pull.repo,
      headSha: plan.headSha,
      clones,
      git: env.git,
      tmp: env.tmp,
      remote: env.remote,
    })
  } catch (error) {
    return refused(`the head could not be checked out: ${message(error)}`)
  }
  let run: ApprovalRun
  try {
    run = await check(deps, pull, plan, judgments, result, { ...where, clones, tree })
  } catch (error) {
    run = refused(`the approval check could not be prepared: ${message(error)}`)
  }
  const leftover = await tree.remove().then(
    () => undefined,
    (error: unknown) => `could not remove the checkout ${tree.path}: ${message(error)}`,
  )
  return leftover === undefined ? run : { ...run, notes: [...run.notes, leftover] }
}

import { resolve } from 'node:path'

import { postFinalReview } from '../review/post.mts'
import { rerenderReport } from '../review/run/report-file.mts'
import { runReview, type ReviewResult } from '../review/run/review.mts'
import { parseModelOverrides } from '../review/models.mts'
import { resolveAnalysis } from '../review/analysis-settings.mts'
import { resolveLimits } from '../review/limits-settings.mts'
import { readFocusFile } from '../run/focus-file.mts'
import { requireValidConfig } from './config-check.mts'
import { resolveModels } from '../review/models-settings.mts'
import { requirePillars } from '../review/pillars-settings.mts'
import { stepWatchFor } from './step-watch-for.mts'
import { recordReview, recordStoppedReview } from '../tracker/record.mts'
import {
  resolveAnswers,
  resolveApprovalCheck,
  resolveEvidence,
  resolveReferences,
  resolveRulePlugins,
  type PullTarget,
} from '../review/index.mts'
import {
  abortCommand,
  claimCommand,
  prepareCommand,
  skipCommand,
  type LoopValues,
} from './command-loop.mts'
import type { ReviewDeps } from './deps.mts'

function jobs(value: string | undefined, fallback: number): number {
  const count = Number(value ?? String(fallback))
  if (!Number.isInteger(count) || count < 1) throw new Error('--jobs must be a positive integer.')
  return count
}

/** `code-reviewer review`: a whole headless review that stops before posting. */
export async function reviewCommand(
  values: LoopValues & {
    jobs?: string | undefined
    model?: string[] | undefined
    'max-cost'?: string | undefined
    quiet?: boolean | undefined
    /** A file of points to check, one per line; `run` reads it first and passes `focusPoints`. */
    focus?: string | undefined
    focusPoints?: readonly string[] | undefined
  },
  target: PullTarget,
  deps: ReviewDeps,
): Promise<ReviewResult> {
  if (values.out === undefined || values.tree === undefined) {
    throw new Error('review needs --out and --tree.')
  }
  // The diff indexes embed these paths, so a relative path would break once a run changes directory.
  const overrides = parseModelOverrides(values.model ?? [])
  const focus =
    values.focusPoints ?? (values.focus === undefined ? undefined : readFocusFile(values.focus))
  const out = resolve(values.out)
  const tree = resolve(values.tree)
  const resolved = {
    ...values,
    out,
    tree,
    ...(values.clones === undefined ? {} : { clones: resolve(values.clones) }),
  }
  const targetOf = () => target
  // Before any claim or model step: a configuration problem stops the review, as it stops `run`.
  const own = (await requireValidConfig(deps, target.repo)).config
  const pillars = requirePillars(deps.configs(), target.repo, own)
  const limits = resolveLimits(deps.configs(), target.repo)
  const tracker = deps.tracker()
  const startedAt = tracker.now().toISOString()
  const running = runReview(
    {
      claim: () => claimCommand(resolved, targetOf, deps),
      prepare: () => prepareCommand(resolved, targetOf, deps),
      skip: (reason, headSha) => skipCommand({ ...resolved, reason }, targetOf, deps, headSha),
      abort: () => abortCommand({ ...resolved, requeue: false }, targetOf, deps),
      preview: (input, headSha) =>
        postFinalReview(deps.createIo(target), input, headSha, { dryRun: true }),
      plugins: () => deps.pluginInfo(),
      // The reviewed repository's own file adds a source only when the machine config trusts it.
      evidence: async () => ({
        sources: resolveEvidence(deps.configs(), target.repo, own).sources,
        readGuide: deps.guideReader(resolved.clones),
      }),
      // Machine config only, even for a trusted repository file: it grants shell commands.
      analysis: async () => ({
        tools: resolveAnalysis(deps.configs(), target.repo).tools,
        readGuide: deps.guideReader(resolved.clones),
      }),
      // Trusted-only for the same reason: a fetch can carry the run's private code out.
      webReferences: resolveReferences(deps.configs(), target.repo, own).sources,
      // Machine config only: a repository must not switch off the check on its own approvals.
      approvalCheck: resolveApprovalCheck(deps.configs(), target.repo).enabled,
      // Machine config only, and off until set: it replies in other reviewers' threads.
      answers: resolveAnswers(deps.configs(), target.repo).enabled,
      // Trusted-only: an enabled plugin loads its hooks too; it must already be installed.
      rulePlugins: resolveRulePlugins(deps.configs(), target.repo, own).names,
      // Machine or repository config; a repository may switch off or add pillars of its own.
      pillars,
      // Machine config, then --model: a repository cannot choose which model reads its code.
      models: {
        plan: resolveModels(deps.configs(), target.repo, overrides).plan,
        limits: {
          runTimeoutMs: limits.runTimeoutSeconds * 1000,
          selectTimeoutMs: limits.selectTimeoutSeconds * 1000,
          contextDeadlineMs: limits.contextDeadlineSeconds * 1000,
        },
        watch: stepWatchFor(values, limits, deps),
      },
      stateDir: tracker.dir,
      exec: deps.exec,
      references: deps.references(),
    },
    {
      repo: target.repo,
      pr: target.pr,
      out,
      tree,
      jobs: jobs(values.jobs, limits.pillarJobs),
      ...(focus === undefined ? {} : { focus }),
    },
  )
  const result = await running.catch((error: unknown) => {
    // Never masks the review's own error; the tracker's problem has nowhere to go on this path.
    recordStoppedReview(tracker, { ...target, out })
    throw error
  })
  const tracked = recordReview(tracker, { ...target, out, startedAt, ...result })
  return { ...result, summary: { ...result.summary, ...tracked } }
}

/** `code-reviewer report`: renders `report.md` again from `report.json`. */
export function reportCommand(values: { out?: string | undefined }): { report: string } {
  if (values.out === undefined) throw new Error('report needs --out.')
  return { report: rerenderReport(resolve(values.out)) }
}

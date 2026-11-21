import { resolve } from 'node:path'

import { postFinalReview } from '../review/post.mts'
import { rerenderReport } from '../review/run/report-file.mts'
import { runReview, type ReviewResult } from '../review/run/review.mts'
import { parseModelOverrides } from '../review/models.mts'
import { resolveAnalysis } from '../review/analysis-settings.mts'
import { resolveModels } from '../review/models-settings.mts'
import { requirePillars } from '../review/pillars-settings.mts'
import { stepWatchFor } from './step-watch-for.mts'
import { recordReview } from '../tracker/record.mts'
import {
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

const DEFAULT_JOBS = 3

function jobs(value: string | undefined): number {
  const count = Number(value ?? String(DEFAULT_JOBS))
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
  },
  target: PullTarget,
  deps: ReviewDeps,
): Promise<ReviewResult> {
  if (values.out === undefined || values.tree === undefined) {
    throw new Error('review needs --out and --tree.')
  }
  // The diff indexes embed these paths, so a relative path would break once a run changes directory.
  const overrides = parseModelOverrides(values.model ?? [])
  const out = resolve(values.out)
  const tree = resolve(values.tree)
  const resolved = {
    ...values,
    out,
    tree,
    ...(values.clones === undefined ? {} : { clones: resolve(values.clones) }),
  }
  const targetOf = () => target
  const own = (await deps.targetConfig(target.repo)).config
  const pillars = requirePillars(deps.configs(), target.repo, own)
  const tracker = deps.tracker()
  const startedAt = tracker.now().toISOString()
  const result = await runReview(
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
      // Trusted-only: an enabled plugin loads its hooks too; it must already be installed.
      rulePlugins: resolveRulePlugins(deps.configs(), target.repo, own).names,
      // Machine or repository config; a repository may switch off or add pillars of its own.
      pillars,
      // Machine config, then --model: a repository cannot choose which model reads its code.
      models: {
        plan: resolveModels(deps.configs(), target.repo, overrides).plan,
        watch: stepWatchFor(values, target.repo, deps),
      },
      exec: deps.exec,
      references: deps.references(),
    },
    { repo: target.repo, pr: target.pr, out, tree, jobs: jobs(values.jobs) },
  )
  const tracked = recordReview(tracker, { ...target, out, startedAt, ...result })
  return { ...result, summary: { ...result.summary, ...tracked } }
}

/** `code-reviewer report`: renders `report.md` again from `report.json`. */
export function reportCommand(values: { out?: string | undefined }): { report: string } {
  if (values.out === undefined) throw new Error('report needs --out.')
  return { report: rerenderReport(resolve(values.out)) }
}

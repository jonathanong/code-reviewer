import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderFollowUpContext } from './context-render.mts'
import { buildFollowUpContext } from './context.mts'
import { planAuthor } from './author-commits.mts'
import type { Effort } from './finding.mts'
import type { PillarSettings } from './pillars-settings.mts'
import { DEFAULT_PLAN_VALUES, type PlanValues } from './plan-settings.mts'
import { planReview, type ReviewPlan } from './plan.mts'
import type { PrepareIo } from './prepare-io.mts'
import { stageRuleSources } from './rules/stage.mts'
import { summarizeStack } from './stack.mts'
import { prepareIssues } from './links-issues.mts'
import { prepareUpgrades, type UpgradesConfig } from './upgrades/prepare.mts'
import { prepareDocs } from './docs-prepare.mts'
import { checkTreeHead } from './prepare-tree.mts'
import { prepareLinks } from './links-prepare.mts'
import { prepareCarried } from './carried-prepare.mts'
import {
  carriedSummary,
  pushFiles,
  pushSummary,
  type CarriedSummary,
  type PushSummary,
} from './prepare-summary.mts'
import { prepareEarlier } from './earlier-prepare.mts'
import type { EarlierFile } from './earlier-file.mts'
import { clearPrepared } from './prepare-clear.mts'
import { prepareStack } from './stack-prepare.mts'
import { pathsChangingSql } from './sql-in-code.mts'
import { prepareSince } from './since-prepare.mts'
import { writeDiff, type Write } from './write-diff.mts'
import { historyHits, reviewableLines } from './triggers.mts'

export type PrepareOptions = {
  out: string
  requested?: Effort
  /** A checkout with history at the base, for the history trigger. */
  tree?: string
  /** A directory of local clones (dependency and consumer repositories). */
  clones?: string
  /** Built-in pillars to skip and extra pillars to run. */
  pillars?: PillarSettings
  /** Configured paths, authors and size threshold. */
  values?: PlanValues
  /** Finds this machine's whole, unposted review of an earlier head; used only when git proves the push light. */
  earlier?: (headSha: string) => EarlierFile | undefined
  upgrades?: UpgradesConfig
}

export type PrepareSummary = {
  headSha: string
  baseSha: string
  files: number
  lines: number
  mode: ReviewPlan['mode']
  plan: ReviewPlan
  /** Files written under `out`, for the pillars and the verifier. */
  written: string[]
  /** Non-fatal problems, such as open pull requests that could not be listed. */
  problems?: string[]
  /** The push since the last trusted review, when it was classified. */
  push?: PushSummary
  /** Commits already in the default branch or another pull request, and a dead base branch. */
  carried?: CarriedSummary
  rules: { related: string[]; consumers: string[]; missing: string[] }
}

/**
 * Gathers everything a review needs into `out` with no model calls: the numbered diff (whole and
 * per file), the follow-up digest, the diff since the last review, and the dispatch plan.
 */
export async function prepareReview(
  io: PrepareIo,
  options: PrepareOptions,
  write: Write = (path, text) => writeFileSync(path, text),
): Promise<PrepareSummary> {
  mkdirSync(options.out, { recursive: true })
  clearPrepared(options.out)
  const [headSha, patch, files, conversation, trusted] = await Promise.all([
    io.headSha(),
    io.diff(options.tree),
    io.files(),
    io.conversation(),
    io.trusted(),
  ])
  const paths = files.map((file) => file.path)
  if (options.tree !== undefined) await checkTreeHead(io, options.tree, headSha)
  const context = buildFollowUpContext(conversation, trusted)
  const values = options.values ?? DEFAULT_PLAN_VALUES
  const written = writeDiff(options.out, 'diff', patch, write)
  const linkedIssues = await prepareIssues(io, options.out, write, conversation)
  write(join(options.out, 'context.md'), renderFollowUpContext(context, linkedIssues.issues))
  write(join(options.out, 'context.json'), `${JSON.stringify(context, null, 2)}\n`)
  written.push('context.md', 'context.json', ...linkedIssues.written)
  const sinceInput = { context, headSha, values }
  const { since, written: sinceFiles } = await prepareSince(io, options.out, write, sinceInput)
  written.push(...sinceFiles)
  const docs = await prepareDocs(io, options.out, write, options.tree, paths)
  written.push(...docs.written)
  const { push, earlier } = await prepareEarlier(io, options.out, write, {
    ...(options.tree === undefined ? {} : { tree: options.tree }),
    context,
    headSha,
    earlier: options.earlier,
  })
  if (push !== undefined) written.push(...pushFiles(push))
  if (earlier !== undefined) written.push('earlier.json')
  const subjects =
    options.tree === undefined ? undefined : await io.history(options.tree, context.baseSha, paths)
  const history = subjects === undefined ? undefined : historyHits(subjects)
  const { stack, problem, open } = await prepareStack(io, options.out, write, options.tree)
  if (stack !== undefined) {
    written.push('stack.json', ...stack.members.flatMap((member) => member.diff ?? []))
  }
  const carried = await prepareCarried(io, options.out, write, {
    ...(options.tree === undefined ? {} : { tree: options.tree }),
    baseSha: context.baseSha,
    headSha,
    baseRef: conversation.baseRefName,
    ...(stack === undefined ? {} : { stack }),
    ...(open === undefined ? {} : { open }),
  })
  if (carried.file !== undefined) written.push('carried.json')
  const links = await prepareLinks(io, options.out, write, {
    ...(options.tree === undefined ? {} : { tree: options.tree }),
    baseSha: context.baseSha,
    headSha,
    body: conversation.body,
    headlines: conversation.commits.nodes.map((node) => node.commit.messageHeadline),
    ...(stack === undefined ? {} : { stack }),
  })
  const upgrades = await prepareUpgrades(io.upgrades, options.out, write, {
    tree: options.tree,
    baseSha: context.baseSha,
    headSha,
    paths,
    config: options.upgrades,
  })
  written.push(...links.written, ...upgrades.written)
  const author = await planAuthor(io, conversation.author, values.authors, headSha)
  const sqlInCode = values.sqlInCode ? pathsChangingSql(patch, values.generatedPaths) : []
  const planned = planReview({
    paths,
    reviewableLines: reviewableLines(files, values.generatedPaths),
    ...(sqlInCode.length === 0 ? {} : { sqlInCode }),
    context,
    ...author,
    ...(options.requested === undefined ? {} : { requested: options.requested }),
    ...(upgrades.found ? { upgrades: true } : {}),
    ...(since === undefined ? {} : { since }),
    ...(push === undefined || push.kind === 'substantive'
      ? {}
      : { push: { kind: push.kind, resolvedPaths: push.resolvedPaths } }),
    ...(history === undefined ? {} : { history }),
    ...(options.pillars === undefined ? {} : { pillars: options.pillars }),
    values,
  })
  const problems = [
    ...(problem === undefined ? [] : [problem]),
    ...(push?.problems ?? []),
    ...carried.problems,
    ...links.problems,
    ...linkedIssues.problems,
    ...docs.problems,
    ...upgrades.problems,
  ]
  const plan = stack === undefined ? planned : { ...planned, stack: summarizeStack(stack) }
  write(join(options.out, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
  const sources = await io.ruleSources({
    ...(options.clones === undefined ? {} : { clones: options.clones }),
    ...(options.tree === undefined ? {} : { tree: options.tree }),
    baseSha: context.baseSha,
  })
  const staged = await stageRuleSources(options.out, {
    changedPaths: paths,
    diff: patch,
    ...sources,
  })
  written.push('plan.json', 'rules/INDEX.md')
  return {
    headSha,
    baseSha: context.baseSha,
    files: paths.length,
    lines: context.lines,
    mode: plan.mode,
    plan,
    ...(problems.length === 0 ? {} : { problems }),
    ...(push === undefined ? {} : { push: pushSummary(push) }),
    ...(carried.file === undefined ? {} : { carried: carriedSummary(carried.file) }),
    written,
    rules: {
      related: staged.related,
      consumers: staged.consumers,
      missing: staged.missing,
    },
  }
}

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderFollowUpContext } from './context-render.mts'
import { buildFollowUpContext } from './context.mts'
import { ReviewError, type Effort } from './finding.mts'
import { numberDiff } from './numbered-diff.mts'
import { planReview, type ReviewPlan, type SinceDiff } from './plan.mts'
import type { PrepareIo } from './prepare-io.mts'
import { stageRuleSources } from './rules/stage.mts'
import { summarizeStack } from './stack.mts'
import { clearCarried } from './carried-file.mts'
import { clearDependencies } from './dependency.mts'
import { clearIssues } from './issues.mts'
import { prepareIssues } from './links-issues.mts'
import { prepareLinks } from './links-prepare.mts'
import { prepareCarried } from './carried-prepare.mts'
import {
  carriedSummary,
  pushFiles,
  pushSummary,
  type CarriedSummary,
  type PushSummary,
} from './prepare-summary.mts'
import { preparePush } from './push-prepare.mts'
import { clearPush } from './push-file.mts'
import { prepareStack } from './stack-prepare.mts'
import { writeDiffDir, type Write } from './write-diff.mts'
import { historyHits, reviewableLines } from './triggers.mts'

export type PrepareOptions = {
  out: string
  requested?: Effort
  /** A checkout with history at the base, for the history trigger. */
  tree?: string
  /** A directory of local clones (dependency and consumer repositories). */
  clones?: string
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
  /** The rule sources staged under `out/rules`: linked repos, unavailable sources. */
  /** Non-fatal problems, such as open pull requests that could not be listed. */
  problems?: string[]
  /** The push since the last trusted review, when it was classified. */
  push?: PushSummary
  /** Commits already in the default branch or another pull request, and a dead base branch. */
  carried?: CarriedSummary
  rules: { related: string[]; consumers: string[]; missing: string[] }
}

function writeDiff(out: string, name: string, patch: string, write: Write): string[] {
  const numbered = numberDiff(patch)
  write(join(out, `${name}.patch`), `${numbered}`)
  writeDiffDir(join(out, name), numbered, write)
  return [`${name}.patch`, `${name}/INDEX.md`]
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
  // A rerun into the same directory must not leave the stack of an earlier run behind.
  rmSync(join(options.out, 'stack.json'), { force: true })
  rmSync(join(options.out, 'stack'), { recursive: true, force: true })
  clearPush(options.out)
  clearCarried(options.out)
  clearDependencies(options.out)
  clearIssues(options.out)
  const [headSha, patch, files, conversation, trusted] = await Promise.all([
    io.headSha(),
    io.diff(options.tree),
    io.files(),
    io.conversation(),
    io.trusted(),
  ])
  const paths = files.map((file) => file.path)
  if (options.tree !== undefined) {
    const treeHead = await io.treeHead(options.tree)
    if (treeHead !== headSha) {
      throw new ReviewError(
        `--tree ${options.tree} is at ${treeHead}, not the pull request head ${headSha}; check out the head and run prepare again.`,
      )
    }
  }
  const context = buildFollowUpContext(conversation, trusted)
  const written = writeDiff(options.out, 'diff', patch, write)
  const linkedIssues = await prepareIssues(io, options.out, write, conversation)
  write(join(options.out, 'context.md'), renderFollowUpContext(context, linkedIssues.issues))
  write(join(options.out, 'context.json'), `${JSON.stringify(context, null, 2)}\n`)
  written.push('context.md', 'context.json', ...linkedIssues.written)
  let since: SinceDiff | undefined
  if (context.reviewedSha !== null && context.reviewedSha !== headSha) {
    since = await io.compare(context.reviewedSha, headSha)
    if (since.status === 'ahead') {
      const sincePatch = await io.compareDiff(context.reviewedSha, headSha)
      written.push(...writeDiff(options.out, 'since', sincePatch, write))
    }
  }
  const push = await preparePush(io, options.out, write, {
    ...(options.tree === undefined ? {} : { tree: options.tree }),
    reviewedSha: context.reviewedSha,
    headSha,
    baseSha: context.baseSha,
  })
  if (push !== undefined) written.push(...pushFiles(push))
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
  written.push(...links.written)
  const planned = planReview({
    paths,
    reviewableLines: reviewableLines(files),
    context,
    authorLogin: conversation.author?.login ?? null,
    authorIsBot: conversation.author?.__typename === 'Bot',
    ...(options.requested === undefined ? {} : { requested: options.requested }),
    ...(since === undefined ? {} : { since }),
    ...(push === undefined || push.kind === 'substantive'
      ? {}
      : { push: { kind: push.kind, resolvedPaths: push.resolvedPaths } }),
    ...(history === undefined ? {} : { history }),
  })
  const problems = [
    ...(problem === undefined ? [] : [problem]),
    ...(push?.problems ?? []),
    ...carried.problems,
    ...links.problems,
    ...linkedIssues.problems,
  ]
  const plan = stack === undefined ? planned : { ...planned, stack: summarizeStack(stack) }
  write(join(options.out, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
  written.push('plan.json')
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
  written.push('rules/INDEX.md')
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

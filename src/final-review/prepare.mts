import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderFollowUpContext } from './context-render.mts'
import { buildFollowUpContext } from './context.mts'
import { diffFileName, renderDiffIndex, splitDiff } from './diff-files.mts'
import type { Effort } from './finding.mts'
import { NUMBERED_DIFF_LEGEND, numberDiff } from './numbered-diff.mts'
import { planReview, type ReviewPlan, type SinceDiff } from './plan.mts'
import type { PrepareIo } from './prepare-io.mts'
import { historyHits } from './triggers.mts'

export type PrepareOptions = {
  out: string
  requested?: Effort
  /** A checkout with history at the base, for the history trigger. */
  tree?: string
}

export type PrepareSummary = {
  headSha: string
  baseSha: string
  files: number
  lines: number
  plan: ReviewPlan
  /** Files written under `out`, for the pillars and the verifier. */
  written: string[]
}

type Write = (path: string, text: string) => void

function writeDiff(out: string, name: string, patch: string, write: Write): string[] {
  const numbered = numberDiff(patch)
  write(join(out, `${name}.patch`), `${numbered}`)
  const dir = join(out, name)
  mkdirSync(dir, { recursive: true })
  const files = splitDiff(numbered)
  files.forEach((file, index) => write(join(dir, diffFileName(index)), file.text))
  const index = `${NUMBERED_DIFF_LEGEND}\n\n${renderDiffIndex(files, dir)}`
  write(join(dir, 'INDEX.md'), index)
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
  const [headSha, patch, paths, conversation] = await Promise.all([
    io.headSha(),
    io.diff(),
    io.paths(),
    io.conversation(),
  ])
  const context = buildFollowUpContext(conversation)
  const written = writeDiff(options.out, 'diff', patch, write)
  write(join(options.out, 'context.md'), renderFollowUpContext(context))
  write(join(options.out, 'context.json'), `${JSON.stringify(context, null, 2)}\n`)
  written.push('context.md', 'context.json')
  let since: SinceDiff | undefined
  if (context.reviewedSha !== null && context.reviewedSha !== headSha) {
    since = await io.compare(context.reviewedSha, headSha)
    if (since.status === 'ahead') {
      const sincePatch = await io.compareDiff(context.reviewedSha, headSha)
      written.push(...writeDiff(options.out, 'since', sincePatch, write))
    }
  }
  const history =
    options.tree === undefined
      ? undefined
      : historyHits(await io.history(options.tree, context.baseSha, paths))
  const plan = planReview({
    paths,
    context,
    ...(options.requested === undefined ? {} : { requested: options.requested }),
    ...(since === undefined ? {} : { since }),
    ...(history === undefined ? {} : { history }),
  })
  write(join(options.out, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
  written.push('plan.json')
  return {
    headSha,
    baseSha: context.baseSha,
    files: paths.length,
    lines: context.lines,
    plan,
    written,
  }
}

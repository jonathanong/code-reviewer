import { join } from 'node:path'

import { splitRepo } from '../gh-cli/index.mts'
import { resolveThreads, type PullTarget } from '../review/index.mts'
import type { Judgment, judgeReplies } from '../review/replies/judge.mts'
import { replyMarker } from '../review/replies/marker.mts'
import { replyReviewInput, type Reassessment } from '../review/replies/reassess.mts'
import { withReplies, type RepliesRecord } from '../review/replies/report.mts'
import type { ReplyPlan } from '../review/replies/select.mts'
import { renderReport } from '../review/run/report-render.mts'
import type { ReportData } from '../review/run/report.mts'
import { postPreparedReview } from './command-post.mts'
import type { ReviewDeps } from './deps.mts'

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const WORDS: Record<Judgment['outcome'], string> = {
  settled: 'Settled',
  downgraded: 'Lowered',
  open: 'Still open',
}

/** The one-line reply in the thread, and the hidden marker that tells the next run it was judged. */
export function replyText(judgment: Judgment): string {
  const lead =
    judgment.outcome === 'downgraded'
      ? `Lowered to \`${judgment.severity}\``
      : WORDS[judgment.outcome]
  const marker =
    judgment.outcome === 'downgraded'
      ? replyMarker('downgraded', judgment.severity)
      : replyMarker(judgment.outcome)
  return `${lead}: ${judgment.why}\n\n${marker}`
}

/** Adds this call's cost to the head's `report.json` and renders `report.md` again; a problem is returned, never thrown. */
export function recordCost(
  deps: ReviewDeps,
  runDir: string,
  record: RepliesRecord,
  judged: Awaited<ReturnType<typeof judgeReplies>>,
): string | undefined {
  try {
    const path = join(runDir, 'report.json')
    const data = JSON.parse(deps.readFile(path)) as ReportData
    const next = withReplies(data, record, judged.usage, judged.ran)
    deps.writeFile(path, `${JSON.stringify(next, null, 2)}\n`)
    deps.writeFile(join(runDir, 'report.md'), renderReport(next))
    return undefined
  } catch (error) {
    return `the cost was not added to ${runDir}/report.json: ${message(error)}`
  }
}

type Write = {
  review: { url: string; event: string } | undefined
  replied: string[]
  resolved: string[]
  problems: string[]
}

/**
 * Posts the new review when the verdict changed, then replies in each judged thread and resolves
 * the settled ones. The review goes first, so a failed post writes nothing in the threads and the
 * command can be run again; a failed reply or resolve is a problem, never an error.
 */
export async function applyWrites(
  deps: ReviewDeps,
  pull: PullTarget,
  plan: ReplyPlan,
  judgments: readonly Judgment[],
  result: Reassessment,
): Promise<Write> {
  const out: Write = { review: undefined, replied: [], resolved: [], problems: [] }
  const io = deps.createIo(pull)
  if (result.changes) {
    const posted = await postPreparedReview({
      pull,
      deps,
      io,
      headSha: plan.headSha,
      input: replyReviewInput(plan, result, judgments),
      dryRun: false,
      author: plan.author,
    })
    out.review = { url: posted.outcome.urls.join(' '), event: posted.outcome.event }
    out.problems.push(...posted.outcome.warnings)
  }
  const answers = deps.createAnswerIo(pull)
  const { owner, name } = splitRepo(pull.repo)
  for (const judgment of judgments) {
    try {
      await answers.reply(judgment.thread, replyText(judgment))
      out.replied.push(judgment.thread)
    } catch (error) {
      out.problems.push(`no reply in thread ${judgment.thread}: ${message(error)}`)
      continue
    }
    if (judgment.outcome !== 'settled') continue
    try {
      await resolveThreads(deps.runner(owner, name), [judgment.thread])
      out.resolved.push(judgment.thread)
    } catch (error) {
      out.problems.push(`thread ${judgment.thread} was not resolved: ${message(error)}`)
    }
  }
  return out
}

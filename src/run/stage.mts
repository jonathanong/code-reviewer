import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { reviewCommand } from '../cli/command-review.mts'
import { postCommand } from '../cli/command-post.mts'
import type { ReviewDeps } from '../cli/deps.mts'
import { resolveRun } from '../review/index.mts'
import type { RunSettings } from '../review/rules/run-parse.mts'
import { changeFacts, runFacts, type RunFacts } from './facts.mts'
import { holdAtCeiling } from './ceiling-hold.mts'
import { reviewFields } from './stage-fields.mts'
import { release, postText, worthALook, writeExplain } from './finish.mts'
import { holdRules, type Held } from './hold.mts'
import { RUN_EXIT, runLine, type RunLine } from './output.mts'
import type { Preflight, RunFlags } from './preflight.mts'
import type { Tree } from './tree.mts'

export type Stage = {
  flags: RunFlags
  /** The read-only preflight of a pull request that is free to review. */
  pre: Extract<Preflight, { names: unknown }>
  deps: ReviewDeps
  tree: Tree
  clones: string | undefined
  jobs: string | undefined
  model: string[] | undefined
  /** `--max-cost` and `--quiet`, handed to `review` as given. */
  limits: { 'max-cost': string | undefined; quiet: boolean | undefined }
  effort: string | undefined
  signal: AbortSignal
  /** What every line of this run carries. */
  base: Partial<RunLine>
}

/** What `post` says when a review may have landed but the read-back could not show it. */
const MAY_HAVE_POSTED = /may have posted|is not on the pull request/u

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Where a run keeps its files: the state directory outlives the temporary tree and a reboot. */
export function runDirFor(deps: ReviewDeps, repo: string, pr: number, headSha: string): string {
  return join(deps.tracker().dir, 'runs', repo.toLowerCase(), `${pr}-${headSha.slice(0, 12)}`)
}

/** The held rules, or `--post hold`'s own reason. */
function decide(
  stage: Stage,
  facts: RunFacts,
  change: ReturnType<typeof changeFacts>,
  tooLong: string[],
  settings: RunSettings,
): Held[] {
  if (stage.flags.post === 'hold') return [{ rule: 'post-hold', why: '--post hold' }]
  return holdRules({ ...facts, ...change, tooLong, authMode: stage.deps.authMode() }, settings)
}

/** The review exists and the claim is held: decide, then post or hold. Any failure releases the claim. */
export async function finish(
  stage: Stage,
  out: string,
  summary: Record<string, unknown>,
): Promise<RunLine> {
  const { deps, flags, pre, signal } = stage
  const { pull } = flags
  const input = join(out, 'review.json')
  const command = postText(pull, pre.headSha, out)
  try {
    const facts = runFacts(out)
    const files = await deps.createPrepareIo(pull).files()
    const values = { 'head-sha': pre.headSha, input }
    const preview = await postCommand({ ...values, 'dry-run': true }, pull, deps)
    const settings = resolveRun(deps.configs(), pull.repo)
    const change = changeFacts(files, facts.author, settings.riskyPaths)
    const held = decide(stage, facts, change, preview.outcome.tooLong, settings)
    signal.throwIfAborted()
    const fields = reviewFields(stage.base, summary, facts)
    const problems = [...facts.partial, ...facts.truncated]
    if (held.length > 0) {
      const leftover = await release(pull, deps, true)
      const explain = writeExplain(deps, out)
      const extra = [leftover, explain.problem].filter((p) => p !== undefined)
      const why = held.map(({ rule, why }) => `${rule}: ${why}`)
      return runLine('held', RUN_EXIT.held, {
        ...fields,
        held: held.map(({ rule }) => rule),
        explainPath: explain.path,
        postCommand: command,
        problems: [...problems, ...extra],
        attention: [...new Set([...why, ...problems, ...extra])],
      })
    }
    const { outcome, printed } = await postCommand(values, pull, deps)
    const explain = writeExplain(deps, out)
    const tracked = (printed as { trackerProblem?: string }).trackerProblem
    // The review is out and the labels have moved, so an unconfirmed read-back is a warning to
    // look at the pull request, not a reason to undo anything.
    const unconfirmed = outcome.confirmed
      ? []
      : ['the review was not confirmed on the pull request']
    const extra = [tracked, explain.problem, ...unconfirmed].filter((p) => p !== undefined)
    return runLine('posted', RUN_EXIT.posted, {
      ...fields,
      verdict: outcome.verdict,
      event: outcome.event,
      // `post` always sends at least one review.
      reviewUrl: outcome.urls[0] as string,
      reviewIds: outcome.reviewIds,
      explainPath: explain.path,
      problems: [...problems, ...extra],
      attention: [...new Set([...problems, ...extra, ...worthALook(outcome)])],
    })
  } catch (error) {
    const leftover = await release(pull, deps, false)
    // `post` throws this when a part may have landed and the read-back could not say. The claim
    // is still released, without a requeue; the unposted review in `runDir` keeps a later run a
    // no-op, so nothing reviews this head again. The post command is withheld until a human looks.
    const unsure = MAY_HAVE_POSTED.test(message(error))
    const reason = unsure
      ? `the review may or may not have posted; look at the pull request before posting again: ${message(error)}`
      : `the review is ready but was not posted: ${message(error)}`
    const problems = leftover === undefined ? [] : [leftover]
    return runLine('error', RUN_EXIT.failed, {
      ...stage.base,
      reason,
      postCommand: unsure ? null : command,
      problems,
      attention: [reason, ...problems],
    })
  }
}

/** Claims through `review`, runs it, and hands a finished review to `finish`. */
export async function reviewStage(stage: Stage): Promise<RunLine> {
  const { deps, flags, pre, tree, signal } = stage
  const { pull } = flags
  const out = runDirFor(deps, pull.repo, pull.pr, pre.headSha)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const base = { ...stage.base, runDir: out }
  const { names, labels } = pre
  // The label state machine stays the one source of truth: a request without a label gets one.
  if (!labels.includes(names.requested) && !labels.includes(names.processing)) {
    await deps.createLabelIo(pull).add([names.requested])
  }
  const abortable: ReviewDeps = {
    ...deps,
    exec: (command, args, options) => deps.exec(command, args, { ...options, signal }),
  }
  const { ok, summary } = await reviewCommand(
    {
      out,
      tree: tree.path,
      force: flags.force,
      ...(stage.clones === undefined ? {} : { clones: stage.clones }),
      ...(stage.jobs === undefined ? {} : { jobs: stage.jobs }),
      ...(stage.model === undefined ? {} : { model: stage.model }),
      ...(stage.limits['max-cost'] === undefined ? {} : { 'max-cost': stage.limits['max-cost'] }),
      ...(stage.limits.quiet === undefined ? {} : { quiet: stage.limits.quiet }),
      ...(stage.effort === undefined ? {} : { effort: stage.effort }),
      ...(flags.focus === undefined ? {} : { focusPoints: flags.focus }),
    },
    pull,
    abortable,
  )
  if (summary.claimed === false) {
    return runLine('noop', RUN_EXIT.noop, { ...base, reason: summary.reason as string })
  }
  if (!ok && summary.costCeilingReached === true) return holdAtCeiling(pull, deps, base, summary)
  if (!ok) {
    const reason = summary.error as string
    const leftover = summary.abortError === undefined ? [] : [summary.abortError as string]
    return runLine('error', RUN_EXIT.failed, {
      ...base,
      reason,
      problems: leftover,
      attention: [reason, ...leftover],
    })
  }
  if (summary.review === null) {
    // A skip plan already posted its skip review and closed the labels.
    return runLine('posted', RUN_EXIT.posted, {
      ...base,
      verdict: 'Skipped',
      mode: 'skip',
      costUsd: 0,
      reason: 'the plan skipped this pull request',
    })
  }
  return finish({ ...stage, base }, out, summary)
}

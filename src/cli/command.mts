import { parseArgs } from 'node:util'

import {
  completeReview,
  reviewStatus,
  numberDiff,
  parseReviewInput,
  postFinalReview,
  postedStep,
  revokeFinalApproval,
  type PullTarget,
} from '../review/index.mts'
import { DEFAULT_TEXT_LIMITS } from '../review/concise.mts'
import { checkPlugins } from '../review/plugins.mts'
import { reportCommand, reviewCommand } from './command-review.mts'
import { runLoopCommand } from './command-loop.mts'
import { checkRunFor, labelsFor } from './review-settings.mts'
import { createDefaultDeps, type ReviewDeps } from './deps.mts'
import { explainCommand, trackerCommand } from './command-tracker.mts'
import { recordPosted } from '../tracker/record.mts'
import { REVIEW_USAGE } from './usage.mts'

export type { ReviewDeps } from './deps.mts'

const SUBCOMMANDS =
  'post, diff, revoke, status, auth, settings, queue, claim, abort, skip, prepare, review, report, resolve, plugins, tracker, explain, bench, bench-verifier, or bench-selection'

function target(values: { repo?: string[] | undefined; pr?: string | undefined }): PullTarget {
  const repo = values.repo?.[0]
  if (repo === undefined || values.pr === undefined)
    throw new Error('--repo and --pr are required.')
  return { repo, pr: Number(values.pr) }
}

function positiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback
  const count = Number(value)
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`--${name} must be a positive integer.`)
  return count
}

function textLimits(values: {
  'body-target'?: string | undefined
  'inline-target'?: string | undefined
}) {
  return {
    bodyTarget: positiveInt(values['body-target'], 'body-target', DEFAULT_TEXT_LIMITS.bodyTarget),
    inlineTarget: positiveInt(
      values['inline-target'],
      'inline-target',
      DEFAULT_TEXT_LIMITS.inlineTarget,
    ),
  }
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function parse(args: string[]) {
  return parseArgs({
    args,
    strict: true,
    options: {
      repo: { type: 'string', multiple: true },
      pr: { type: 'string' },
      'head-sha': { type: 'string' },
      input: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'allow-long': { type: 'boolean' },
      'body-target': { type: 'string' },
      'inline-target': { type: 'string' },
      owner: { type: 'string' },
      force: { type: 'boolean' },
      requeue: { type: 'boolean' },
      reason: { type: 'string' },
      out: { type: 'string' },
      jobs: { type: 'string' },
      effort: { type: 'string' },
      tree: { type: 'string' },
      clones: { type: 'string' },
      thread: { type: 'string', multiple: true },
      require: { type: 'string', multiple: true },
      since: { type: 'string' },
      state: { type: 'string' },
      format: { type: 'string' },
      run: { type: 'string' },
    },
  }).values
}

async function run(
  subcommand: string | undefined,
  args: string[],
  deps: ReviewDeps,
): Promise<number> {
  if (subcommand === 'help' || subcommand === '--help') {
    process.stdout.write(REVIEW_USAGE)
    return 0
  }
  if (subcommand === 'bench') return deps.runBench(args)
  if (subcommand === 'bench-verifier') return deps.runVerifierBench(args)
  if (subcommand === 'bench-selection') return deps.runSelectionBench(args)
  const values = parse(args)
  if (subcommand === undefined) throw new Error(`give a subcommand: ${SUBCOMMANDS}.`)
  if (subcommand === 'plugins') {
    const result = checkPlugins(await deps.listPlugins(), values.require ?? [])
    print(result)
    return result.missing.length === 0 ? 0 : 1
  }
  if (subcommand === 'tracker') {
    const { output, problems } = trackerCommand(values, deps.tracker())
    for (const problem of problems) process.stderr.write(`code-reviewer: ${problem}\n`)
    process.stdout.write(output)
    return 0
  }
  if (subcommand === 'explain') {
    process.stdout.write(explainCommand(values, deps.tracker()))
    return 0
  }
  if (subcommand === 'report') {
    print(reportCommand(values))
    return 0
  }
  if (subcommand === 'review') {
    const result = await reviewCommand(values, target(values), deps)
    print(result.summary)
    return result.ok ? 0 : 1
  }
  const loop = await runLoopCommand(subcommand, values, () => target(values), deps)
  if (loop !== undefined) {
    print(loop)
    return 0
  }
  const pull = target(values)
  const io = deps.createIo(pull)
  switch (subcommand) {
    case 'post': {
      if (values['head-sha'] === undefined || values.input === undefined) {
        throw new Error('post needs --head-sha and --input.')
      }
      const input = parseReviewInput(JSON.parse(deps.readFile(values.input)) as unknown)
      const dryRun = values['dry-run'] === true
      const outcome = await postFinalReview(io, input, values['head-sha'], {
        dryRun,
        allowLong: values['allow-long'] === true,
        textLimits: textLimits(values),
      })
      if (dryRun) {
        print(outcome)
        return 0
      }
      const lifecycle = await completeReview(
        deps.createLabelIo(pull),
        await labelsFor(deps, pull.repo),
      )
      const checkRun = await checkRunFor(
        deps,
        pull,
        postedStep(outcome.verdict, outcome.urls),
        values['head-sha'],
      )
      const tracked = recordPosted(deps.tracker(), {
        ...pull,
        headSha: values['head-sha'],
        input: values.input,
        findings: input.findings,
        outcome,
      })
      print({ ...outcome, reviews: outcome.reviews.length, lifecycle, checkRun, ...tracked })
      return 0
    }
    case 'diff':
      process.stdout.write(numberDiff(await io.diff()))
      return 0
    case 'revoke':
      print({ removed: await revokeFinalApproval(io) })
      return 0
    case 'status': {
      const found = await reviewStatus(io)
      // A skip stands only while its completed label does: a new request or claim removes it.
      const skipped =
        found.skipped &&
        (await deps.createLabelIo(pull).labels()).includes(
          (await labelsFor(deps, pull.repo)).completed,
        )
      const status = { ...found, skipped }
      print(status)
      return status.approved || status.skipped ? 0 : 1
    }
    default:
      throw new Error(`give a subcommand: ${SUBCOMMANDS}.`)
  }
}

export async function runReviewCommand(
  args: string[],
  deps: ReviewDeps = createDefaultDeps(),
): Promise<number> {
  try {
    return await run(args[0], args.slice(1), deps)
  } catch (error) {
    process.stderr.write(
      `code-reviewer: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 2
  }
}

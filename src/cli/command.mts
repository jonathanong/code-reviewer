import { parseArgs } from 'node:util'

import {
  completeReview,
  finalReviewStatus,
  numberDiff,
  parseFinalReviewInput,
  postFinalReview,
  postedStep,
  revokeFinalApproval,
  type PullTarget,
} from '../final-review/index.mts'
import { checkPlugins } from '../final-review/plugins.mts'
import { reportCommand, reviewCommand } from './command-review.mts'
import { runLoopCommand } from './command-loop.mts'
import { checkRunFor, labelsFor } from './review-settings.mts'
import { createDefaultDeps, type FinalReviewDeps } from './deps.mts'
import { FINAL_REVIEW_USAGE } from './usage.mts'

export type { FinalReviewDeps } from './deps.mts'

const SUBCOMMANDS =
  'post, diff, revoke, status, auth, settings, queue, claim, abort, skip, prepare, review, report, resolve, plugins, bench, or bench-verifier'

function target(values: { repo?: string[] | undefined; pr?: string | undefined }): PullTarget {
  const repo = values.repo?.[0]
  if (repo === undefined || values.pr === undefined)
    throw new Error('--repo and --pr are required.')
  return { repo, pr: Number(values.pr) }
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
    },
  }).values
}

async function run(
  subcommand: string | undefined,
  args: string[],
  deps: FinalReviewDeps,
): Promise<number> {
  if (subcommand === 'help' || subcommand === '--help') {
    process.stdout.write(FINAL_REVIEW_USAGE)
    return 0
  }
  if (subcommand === 'bench') return deps.runBench(args)
  if (subcommand === 'bench-verifier') return deps.runVerifierBench(args)
  const values = parse(args)
  if (subcommand === undefined) throw new Error(`final-review needs ${SUBCOMMANDS}.`)
  if (subcommand === 'plugins') {
    const result = checkPlugins(await deps.listPlugins(), values.require ?? [])
    print(result)
    return result.missing.length === 0 ? 0 : 1
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
      const input = parseFinalReviewInput(JSON.parse(deps.readFile(values.input)) as unknown)
      const dryRun = values['dry-run'] === true
      const outcome = await postFinalReview(io, input, values['head-sha'], { dryRun })
      if (dryRun) {
        print(outcome)
        return 0
      }
      const lifecycle = await completeReview(deps.createLabelIo(pull), labelsFor(deps, pull.repo))
      const checkRun = await checkRunFor(
        deps,
        pull,
        postedStep(outcome.verdict, outcome.urls),
        values['head-sha'],
      )
      print({ ...outcome, reviews: outcome.reviews.length, lifecycle, checkRun })
      return 0
    }
    case 'diff':
      process.stdout.write(numberDiff(await io.diff()))
      return 0
    case 'revoke':
      print({ removed: await revokeFinalApproval(io) })
      return 0
    case 'status': {
      const status = await finalReviewStatus(io)
      print(status)
      return status.approved ? 0 : 1
    }
    default:
      throw new Error(`final-review needs ${SUBCOMMANDS}.`)
  }
}

export async function runFinalReviewCommand(
  args: string[],
  deps: FinalReviewDeps = createDefaultDeps(),
): Promise<number> {
  try {
    return await run(args[0], args.slice(1), deps)
  } catch (error) {
    process.stderr.write(
      `final-review: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 2
  }
}

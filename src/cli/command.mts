import { parseArgs } from 'node:util'

import {
  completeReview,
  finalReviewStatus,
  numberDiff,
  parseFinalReviewInput,
  postFinalReview,
  revokeFinalApproval,
  type PullTarget,
} from '../final-review/index.mts'
import { runLoopCommand } from './command-loop.mts'
import { createDefaultDeps, type FinalReviewDeps } from './deps.mts'
import { FINAL_REVIEW_USAGE } from './usage.mts'

export type { FinalReviewDeps } from './deps.mts'

const SUBCOMMANDS =
  'post, diff, revoke, status, auth, queue, claim, abort, prepare, resolve, bench, or bench-verifier'

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
      out: { type: 'string' },
      effort: { type: 'string' },
      tree: { type: 'string' },
      clones: { type: 'string' },
      thread: { type: 'string', multiple: true },
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
      const labels = await completeReview(deps.createLabelIo(pull))
      print({ ...outcome, reviews: outcome.reviews.length, lifecycle: labels })
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

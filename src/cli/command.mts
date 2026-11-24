import { reviewStatus, numberDiff, revokeFinalApproval, type PullTarget } from '../review/index.mts'
import { runGit, takeRetryCount } from '../gh-cli/index.mts'
import { checkPlugins } from '../review/plugins.mts'
import { reportCommand, reviewCommand } from './command-review.mts'
import { contextCommand } from './command-context.mts'
import { doctorCommand } from './command-doctor.mts'
import { requireApp } from './command-auth.mts'
import { carryCommand } from './command-carry.mts'
import { runLoopCommand } from './command-loop.mts'
import { postCommand } from './command-post.mts'
import { labelsFor } from './review-settings.mts'
import { createDefaultDeps, type ReviewDeps } from './deps.mts'
import { explainCommand, trackerCommand } from './command-tracker.mts'
import { runCommand, usageFailure } from '../run/command.mts'
import { modelsCommand } from '../models/command.mts'
import { digestCommand, outcomesCommand } from '../outcomes/command.mts'
import { issuesCommand } from '../issues/command.mts'
import { createIssuesIo } from '../issues/io.mts'
import { parse } from './parse.mts'
import { REVIEW_USAGE } from './usage.mts'

export type { ReviewDeps } from './deps.mts'

const SUBCOMMANDS =
  'post, carry, diff, revoke, status, auth, settings, queue, claim, abort, skip, prepare, review, run, context, report, resolve, plugins, tracker, explain, outcomes, issues, doctor, models, bench, bench-verifier, bench-selection, bench-context, or bench-focus'

/** Subcommands that call GitHub for a repository or owner; `run` checks the App in its own preflight. */
const NEEDS_IDENTITY = new Set([
  'post',
  'carry',
  'status',
  'claim',
  'skip',
  'prepare',
  'review',
  'context',
])
const NEEDS_APP = new Set([
  ...NEEDS_IDENTITY,
  'diff',
  'revoke',
  'abort',
  'queue',
  'resolve',
  'settings',
  'outcomes',
])

function target(values: { repo?: string[] | undefined; pr?: string | undefined }): PullTarget {
  const repo = values.repo?.[0]
  if (repo === undefined || values.pr === undefined)
    throw new Error('--repo and --pr are required.')
  return { repo, pr: Number(values.pr) }
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
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
  if (subcommand === 'bench-context') return deps.runContextBench(args)
  if (subcommand === 'bench-focus') return deps.runFocusBench(args)
  const digest = subcommand === 'outcomes' && args[0] === 'digest'
  const values = parse(digest ? args.slice(1) : args)
  if (subcommand === undefined) throw new Error(`give a subcommand: ${SUBCOMMANDS}.`)
  if (!digest && NEEDS_APP.has(subcommand)) {
    await requireApp(values, deps, NEEDS_IDENTITY.has(subcommand))
  }
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
  if (subcommand === 'outcomes') {
    if (digest) {
      print(digestCommand(values, deps.tracker()))
      return 0
    }
    const io = {
      run: (owner: string, repo: string) => deps.runner(owner, repo),
      git: runGit,
      findClone: deps.findClone(values.clones),
    }
    const { summary, messages } = await outcomesCommand(values, deps.tracker(), io)
    for (const message of messages) process.stderr.write(`code-reviewer: ${message}\n`)
    print(summary)
    return 0
  }
  if (subcommand === 'issues') {
    const { result, messages } = await issuesCommand(
      values,
      deps.configs(),
      deps.tracker(),
      createIssuesIo((owner, repo) => deps.runner(owner, repo)),
    )
    for (const message of messages) process.stderr.write(`code-reviewer: ${message}\n`)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return 0
  }
  if (subcommand === 'explain') {
    process.stdout.write(explainCommand(values, deps.tracker()))
    return 0
  }
  if (subcommand === 'doctor') return doctorCommand(values, deps)
  if (subcommand === 'models') return modelsCommand(values, deps.exec)
  if (subcommand === 'report') {
    print(reportCommand(values))
    return 0
  }
  if (subcommand === 'run') return runCommand(values, deps)
  if (subcommand === 'context') return contextCommand(values, deps)
  if (subcommand === 'review') {
    const result = await reviewCommand(values, target(values), deps)
    print(result.summary)
    return result.ok ? 0 : 1
  }
  const loop = await runLoopCommand(subcommand, values, () => target(values), deps)
  if (loop !== undefined) {
    print(loop)
    return typeof loop === 'object' && loop !== null && 'installationError' in loop ? 1 : 0
  }
  const pull = target(values)
  const io = deps.createIo(pull)
  switch (subcommand) {
    case 'post':
      print((await postCommand(values, pull, deps)).printed)
      return 0
    case 'carry': {
      const result = await carryCommand(values, pull, deps)
      process.stdout.write(result.text)
      return result.exitCode
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
    const reason = error instanceof Error ? error.message : String(error)
    // A caller of `run` reads one JSON line and the exit code, even for a bad flag.
    if (args[0] === 'run') return usageFailure(reason)
    process.stderr.write(`code-reviewer: ${reason}\n`)
    return 2
  } finally {
    const retries = takeRetryCount()
    if (retries > 0) {
      process.stderr.write(
        `code-reviewer: warning: ${retries} GitHub ${retries === 1 ? 'call was' : 'calls were'} retried after transient failures.\n`,
      )
    }
  }
}

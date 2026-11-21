import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { runGit, type RunTextCommand } from '../gh-cli/index.mts'
import type { ReviewDeps } from '../cli/deps.mts'
import { watchInterrupts, type SignalSource } from './interrupt.mts'
import { RUN_EXIT, runLine, writeLine, type RunExit, type RunLine } from './output.mts'
import { Precondition, checkPreconditions, parseFlags, preflight } from './preflight.mts'
import { reviewStage } from './stage.mts'
import { checkoutHead, type Tree } from './tree.mts'

export type RunValues = {
  repo?: string[] | undefined
  pr?: string | undefined
  post?: string | undefined
  effort?: string | undefined
  force?: boolean | undefined
  jobs?: string | undefined
  model?: string[] | undefined
  clones?: string | undefined
}

/** The machine around the command, replaceable in a test. */
export type RunEnv = {
  env: Record<string, string | undefined>
  /** Where the temporary checkout goes. */
  tmp: string
  git: RunTextCommand
  remote: (repo: string) => string
  signals: SignalSource
}

export function defaultRunEnv(): RunEnv {
  return {
    env: process.env,
    tmp: tmpdir(),
    git: runGit,
    remote: (repo) => `https://github.com/${repo}.git`,
    signals: process,
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function failure(error: unknown, base: Partial<RunLine>): RunLine {
  const reason = message(error)
  const code = error instanceof Precondition ? RUN_EXIT.precondition : RUN_EXIT.failed
  return runLine('error', code, { ...base, reason, attention: [reason] })
}

/** The line for a flag the command could not even parse. */
export function usageFailure(reason: string): RunExit {
  return writeLine(failure(new Precondition(reason), {}))
}

async function removeTree(tree: Tree): Promise<string | undefined> {
  try {
    await tree.remove()
    return undefined
  } catch (error) {
    return `could not remove the checkout ${tree.path}: ${message(error)}`
  }
}

async function execute(
  values: RunValues,
  deps: ReviewDeps,
  env: RunEnv,
  signal: AbortSignal,
  base: Partial<RunLine>,
): Promise<RunLine> {
  const flags = parseFlags(values)
  const { pull } = flags
  Object.assign(base, { repo: pull.repo, pr: pull.pr })
  await checkPreconditions(deps, pull.repo)
  const pre = await preflight(deps, pull, flags.force)
  base.headSha = pre.headSha
  if (pre.noop !== undefined) return runLine('noop', RUN_EXIT.noop, { ...base, reason: pre.noop })
  const root = values.clones ?? env.env.CODE_REVIEWER_CLONE_ROOT
  const clones = root === undefined ? undefined : resolve(root)
  const tree = await checkoutHead({
    repo: pull.repo,
    headSha: pre.headSha,
    clones,
    git: env.git,
    tmp: env.tmp,
    remote: env.remote,
  })
  base.tree = tree.kind
  let line: RunLine
  try {
    line = await reviewStage({
      flags,
      pre,
      deps,
      tree,
      clones,
      jobs: values.jobs,
      model: values.model,
      effort: values.effort,
      signal,
      base,
    })
  } catch (error) {
    line = failure(error, base)
  }
  const leftover = await removeTree(tree)
  if (leftover === undefined) return line
  return {
    ...line,
    problems: [...line.problems, leftover],
    attention: [...line.attention, leftover],
  }
}

/**
 * `code-reviewer run`: one unattended review of a pull request, from claim to post or hold, that
 * prints one JSON line and exits with a code a caller can branch on (see `RUN_EXIT`).
 */
export async function runCommand(
  values: RunValues,
  deps: ReviewDeps,
  env: RunEnv = defaultRunEnv(),
): Promise<RunExit> {
  const watch = watchInterrupts(env.signals)
  const base: Partial<RunLine> = {}
  try {
    return writeLine(await execute(values, deps, env, watch.signal, base))
  } catch (error) {
    return writeLine(failure(error, base))
  } finally {
    watch.dispose()
  }
}

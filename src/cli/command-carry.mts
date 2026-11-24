import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runGit, splitRepo, type RunTextCommand } from '../gh-cli/index.mts'
import { assertPullTarget, type PullTarget } from '../review/index.mts'
import { formatDelta, type CarryComparison } from '../review/carry-diff.mts'
import { diffHeadChanges } from '../review/carry-git.mts'
import { carriedReviewInput, verifyApprovedSource } from '../review/carry-source.mts'
import { SHA_RE } from '../review/post.mts'
import { RUN_EXIT } from '../run/output.mts'
import { postPreparedReview } from './command-post.mts'
import { requireValidConfig } from './config-check.mts'
import type { ReviewDeps } from './deps.mts'

export type CarryValues = {
  'from-sha'?: string | undefined
  'allow-delta'?: boolean | undefined
  'dry-run'?: boolean | undefined
  clones?: string | undefined
}

/** External environment for `carry`, injectable in tests. */
export type CarryEnv = {
  git: RunTextCommand
  tmp: string
  remote: (repo: string) => string
}

export function defaultCarryEnv(): CarryEnv {
  return {
    git: runGit,
    tmp: tmpdir(),
    remote: (repo) => `https://github.com/${repo}.git`,
  }
}

export type CarryOutput = {
  exitCode: number
  text: string
}

async function readHeadAndBase(
  deps: ReviewDeps,
  pull: PullTarget,
): Promise<{ baseRefOid: string; headRefOid: string }> {
  const { owner, name } = splitRepo(pull.repo)
  const view = await deps.runner(
    owner,
    name,
  )(['pr', 'view', String(pull.pr), '-R', pull.repo, '--json', 'baseRefOid,headRefOid'])
  return JSON.parse(view) as { baseRefOid: string; headRefOid: string }
}

async function compareInGit(
  deps: ReviewDeps,
  env: CarryEnv,
  repo: string,
  clones: string | undefined,
  shas: { baseSha: string; fromSha: string; headSha: string },
): Promise<CarryComparison> {
  const clone = await deps.findClone(clones)(repo)
  if (clone !== undefined) return diffHeadChanges(env.git, clone, shas)
  const base = mkdtempSync(join(env.tmp, 'code-reviewer-carry-'))
  const tree = join(base, 'tree')
  try {
    await env.git([
      'clone',
      '--quiet',
      '--filter=blob:none',
      '--no-checkout',
      env.remote(repo),
      tree,
    ])
    return await diffHeadChanges(env.git, tree, shas)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

/**
 * `code-reviewer carry`: carries an earlier Approve review from `--from-sha` to the pull request's
 * current head without a model call when the changes against the base are identical, or with
 * `--allow-delta` after the caller has inspected the delta.
 */
export async function carryCommand(
  values: CarryValues,
  pull: PullTarget,
  deps: ReviewDeps,
  env: CarryEnv = defaultCarryEnv(),
): Promise<CarryOutput> {
  assertPullTarget(pull)
  const fromSha = values['from-sha']
  if (fromSha === undefined) throw new Error('carry needs --from-sha.')
  if (!SHA_RE.test(fromSha)) throw new Error('--from-sha must be a full lowercase SHA.')
  await requireValidConfig(deps, pull.repo)
  const { baseRefOid, headRefOid } = await readHeadAndBase(deps, pull)
  if (headRefOid === fromSha) {
    return {
      exitCode: RUN_EXIT.noop,
      text: `${JSON.stringify(
        {
          outcome: 'noop',
          reason: 'nothing to do: head already equals --from-sha',
          fromSha,
          headSha: headRefOid,
        },
        null,
        2,
      )}\n`,
    }
  }
  const io = deps.createIo(pull)
  const { effort } = await verifyApprovedSource(io, deps.tracker(), pull, fromSha)
  const comparison = await compareInGit(deps, env, pull.repo, values.clones, {
    baseSha: baseRefOid,
    fromSha,
    headSha: headRefOid,
  })
  if (!comparison.identical && values['allow-delta'] !== true) {
    return { exitCode: 1, text: formatDelta(comparison, fromSha, headRefOid) }
  }
  const deltaFiles = comparison.files.map((file) => file.path)
  const input = carriedReviewInput(fromSha, effort, deltaFiles)
  const posted = await postPreparedReview({
    pull,
    deps,
    io,
    headSha: headRefOid,
    input,
    dryRun: values['dry-run'] === true,
  })
  const printed = {
    ...posted.printed,
    carriedFrom: fromSha,
    ...(deltaFiles.length === 0 ? {} : { deltaFiles }),
  }
  return { exitCode: 0, text: `${JSON.stringify(printed, null, 2)}\n` }
}

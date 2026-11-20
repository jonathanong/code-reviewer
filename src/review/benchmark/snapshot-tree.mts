import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Exec } from './exec.mts'
import { CONTEXT_DIR } from './snapshot-context.mts'

export type TreeCommits = { baseBranch: string; baseSha: string; headSha: string }

/**
 * Builds a git checkout of a pull request head that reads its history from the cache's objects
 * through `alternates`: HEAD is detached at the head, `origin/<base branch>` and `origin/HEAD`
 * point at the base, and no remote is configured, so nothing can be fetched into it.
 */
export async function buildTree(
  dir: string,
  repoDir: string,
  commits: TreeCommits,
  exec: Exec,
): Promise<void> {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  await exec('git', ['-C', dir, 'init', '--quiet'])
  const git = join(dir, '.git')
  mkdirSync(join(git, 'objects', 'info'), { recursive: true })
  mkdirSync(join(git, 'info'), { recursive: true })
  writeFileSync(join(git, 'objects', 'info', 'alternates'), `${join(repoDir, 'objects')}\n`)
  // The context files are not part of the pull request, so `git status` stays clean.
  writeFileSync(join(git, 'info', 'exclude'), `${CONTEXT_DIR}/\n`)
  const baseRef = `refs/remotes/origin/${commits.baseBranch}`
  await exec('git', ['-C', dir, 'update-ref', baseRef, commits.baseSha])
  await exec('git', ['-C', dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', baseRef])
  await exec('git', ['-C', dir, 'checkout', '--quiet', '--detach', commits.headSha])
}

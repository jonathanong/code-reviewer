import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { isFixtureCase, type EvalCase, type RepoCase } from './cases.mts'
import { defaultExec, type Exec } from './exec.mts'
import { writeContext, type Snapshot } from './snapshot-context.mts'
import { prepareFixtureSnapshot } from './snapshot-fixture.mts'

export { defaultExec, ExecError, type Exec } from './exec.mts'
export { CONTEXT_DIR, hasContextNotes, hasRulesIndex, type Snapshot } from './snapshot-context.mts'
export { normalizeFixtureDiff } from './snapshot-fixture.mts'

const pendingClones = new Map<string, Promise<unknown>>()

/** Clones a repository once, so parallel cases sharing one wait instead of cloning over it. */
async function ensureClone(repo: string, repoDir: string, exec: Exec): Promise<void> {
  const pending = pendingClones.get(repoDir)
  if (pending !== undefined) {
    await pending
    return
  }
  if (existsSync(join(repoDir, '.git'))) return
  const args = [
    'repo',
    'clone',
    repo,
    repoDir,
    '--',
    '--filter=blob:none',
    '--no-checkout',
    '--quiet',
  ]
  const clone = exec('gh', args).finally(() => pendingClones.delete(repoDir))
  pendingClones.set(repoDir, clone)
  await clone
}

/**
 * Exports the pre-merge head as a tree without `.git`, so the reviewer cannot read later history
 * (the revert, follow-up fixes) that would leak the answer.
 */
async function prepareRepoSnapshot(
  item: RepoCase,
  cacheRoot: string,
  workRoot: string,
  exec: Exec = defaultExec,
): Promise<Snapshot> {
  const repoDir = join(cacheRoot, item.repo.replace('/', '__'))
  mkdirSync(cacheRoot, { recursive: true })
  await ensureClone(item.repo, repoDir, exec)
  await exec('git', ['-C', repoDir, 'fetch', '--quiet', 'origin', item.baseSha, item.headSha])
  const caseRoot = join(workRoot, item.id)
  const dir = join(caseRoot, 'tree')
  rmSync(caseRoot, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const tar = join(caseRoot, 'tree.tar')
  await exec('git', ['-C', repoDir, 'archive', '--format=tar', '-o', tar, item.headSha])
  await exec('tar', ['-xf', tar, '-C', dir])
  rmSync(tar, { force: true })
  const diff = await exec('git', [
    '-C',
    repoDir,
    'diff',
    '--no-color',
    `${item.baseSha}...${item.headSha}`,
  ])
  const body = await exec('gh', [
    'pr',
    'view',
    String(item.pr),
    '-R',
    item.repo,
    '--json',
    'body',
    '-q',
    '.body',
  ])
  writeContext(dir, item.title, diff, body)
  return { dir, diff, body }
}

/** Exports a case's pull request head (or fixture head) and its diff for the reviewer. */
export async function prepareSnapshot(
  item: EvalCase,
  cacheRoot: string,
  workRoot: string,
  exec: Exec = defaultExec,
): Promise<Snapshot> {
  if (isFixtureCase(item)) return prepareFixtureSnapshot(item, workRoot, exec)
  return prepareRepoSnapshot(item, cacheRoot, workRoot, exec)
}

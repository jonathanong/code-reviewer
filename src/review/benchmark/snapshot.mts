import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { isFixtureCase, type EvalCase, type RepoCase } from './cases.mts'
import { defaultExec, type Exec } from './exec.mts'
import { cacheDirOf, ensureCache, fetchCommits } from './snapshot-cache.mts'
import { onlyPathDiff } from './only-path.mts'
import { writeContext, writeRelatedDocs, type Snapshot } from './snapshot-context.mts'
import { prepareFixtureSnapshot } from './snapshot-fixture.mts'
import { buildTree } from './snapshot-tree.mts'

export { defaultExec, ExecError, type Exec } from './exec.mts'
export {
  CONTEXT_DIR,
  hasContextNotes,
  hasRulesIndex,
  relatedDocs,
  type Snapshot,
} from './snapshot-context.mts'
export { normalizeFixtureDiff } from './snapshot-fixture.mts'

/** What `gh pr view` reports about a pull request that the snapshot needs. */
function parsePullRequest(json: string): { body: string; baseBranch: string } {
  const parsed = JSON.parse(json) as { body?: unknown; baseRefName?: unknown }
  const { body, baseRefName } = parsed
  if (typeof body !== 'string' || typeof baseRefName !== 'string' || baseRefName === '') {
    throw new Error('gh pr view returned no body or base branch')
  }
  return { body, baseBranch: baseRefName }
}

/**
 * Builds a git checkout of the pull request head: full history up to the head and a base ref, and
 * no commit after the head, since a later revert or fix would leak the answer.
 */
async function prepareRepoSnapshot(
  item: RepoCase,
  cacheRoot: string,
  workRoot: string,
  exec: Exec = defaultExec,
  onlyPath?: readonly string[],
): Promise<Snapshot> {
  const repoDir = cacheDirOf(cacheRoot, item.repo)
  mkdirSync(cacheRoot, { recursive: true })
  await ensureCache(item.repo, repoDir, exec)
  await fetchCommits(repoDir, item.baseSha, item.headSha, exec)
  const dir = join(workRoot, item.id, 'tree')
  const view = await exec('gh', [
    'pr',
    'view',
    String(item.pr),
    '-R',
    item.repo,
    '--json',
    'body,baseRefName',
  ])
  const { body: current, baseBranch } = parsePullRequest(view)
  // A description edited after the head was pushed can state the fix a later head made.
  const body = item.body ?? current
  await buildTree(dir, repoDir, { baseBranch, baseSha: item.baseSha, headSha: item.headSha }, exec)
  const full = await exec('git', [
    '-C',
    repoDir,
    'diff',
    '--no-color',
    `${item.baseSha}...${item.headSha}`,
  ])
  const diff = onlyPathDiff(item.id, full, onlyPath)
  writeContext(dir, item.title, diff, body)
  await writeRelatedDocs(dir, diff, exec)
  return { dir, diff, body }
}

/** Exports a case's pull request head (or fixture head) and its diff for the reviewer. */
export async function prepareSnapshot(
  item: EvalCase,
  cacheRoot: string,
  workRoot: string,
  exec: Exec = defaultExec,
  onlyPath?: readonly string[],
): Promise<Snapshot> {
  if (isFixtureCase(item)) return prepareFixtureSnapshot(item, workRoot, exec, onlyPath)
  return prepareRepoSnapshot(item, cacheRoot, workRoot, exec, onlyPath)
}

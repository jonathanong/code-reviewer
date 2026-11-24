import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { Exec } from './exec.mts'

const pendingCaches = new Map<string, Promise<unknown>>()

/** Credentials come from `gh`, the login the rest of the bench uses; nothing is written to config. */
const GH_CREDENTIALS = [
  '-c',
  'credential.helper=',
  '-c',
  'credential.helper=!gh auth git-credential',
]

/** The cache directory of a repository: a bare repo, named apart from the older full clones. */
export function cacheDirOf(cacheRoot: string, repo: string): string {
  return join(cacheRoot, `${repo.replace('/', '__')}.git`)
}

async function createCache(repo: string, repoDir: string, exec: Exec): Promise<void> {
  const url = (await exec('gh', ['repo', 'view', repo, '--json', 'url', '-q', '.url'])).trim()
  try {
    await exec('git', ['init', '--quiet', '--bare', repoDir])
    await exec('git', ['-C', repoDir, 'remote', 'add', 'origin', url])
  } catch (error) {
    rmSync(repoDir, { recursive: true, force: true })
    throw error
  }
}

/**
 * Creates a repository's bare cache once, so parallel cases sharing one wait instead of creating
 * it over each other. The cache has an `origin` and no refspec: it holds only the commits a case
 * fetched by SHA, never a branch.
 */
export async function ensureCache(repo: string, repoDir: string, exec: Exec): Promise<void> {
  const pending = pendingCaches.get(repoDir)
  if (pending !== undefined) {
    await pending
    return
  }
  if (existsSync(join(repoDir, 'HEAD'))) return
  const created = createCache(repo, repoDir, exec).finally(() => pendingCaches.delete(repoDir))
  pendingCaches.set(repoDir, created)
  await created
}

/** Fetches commits by SHA, with their full history, into the cache. */
export async function fetchShas(
  repoDir: string,
  shas: readonly string[],
  exec: Exec,
): Promise<void> {
  await exec('git', [
    ...GH_CREDENTIALS,
    '-C',
    repoDir,
    'fetch',
    '--quiet',
    '--no-tags',
    'origin',
    ...shas,
  ])
}

/** Fetches the base and head commits, with their full history and nothing newer. */
export const fetchCommits = (repoDir: string, baseSha: string, headSha: string, exec: Exec) =>
  fetchShas(repoDir, [baseSha, headSha], exec)

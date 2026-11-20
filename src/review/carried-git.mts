import type { TreeGit } from './push-git.mts'

export type RangeCommit = { sha: string; subject: string }

const lines = (out: string) => out.split('\n').filter((line) => line !== '')

export async function hasCommit(git: TreeGit, ref: string): Promise<boolean> {
  try {
    await git('cat-file', '-e', `${ref}^{commit}`)
    return true
  } catch {
    return false
  }
}

/** The non-merge commits of `from..to`, oldest first; at most `max` of the newest. */
export async function rangeCommits(
  git: TreeGit,
  from: string,
  to: string,
  max: number,
): Promise<RangeCommit[]> {
  const out = await git(
    'log',
    '--no-merges',
    '--reverse',
    '--format=%H%x09%s',
    `--max-count=${max}`,
    `${from}..${to}`,
  )
  return lines(out).map((line) => {
    const [sha, ...subject] = line.split('\t') as [string, ...string[]]
    return { sha, subject: subject.join('\t') }
  })
}

/** Commits of `limit..head` that `upstream` holds an equivalent patch for (`git cherry`). */
export async function patchEquivalent(
  git: TreeGit,
  upstream: string,
  head: string,
  limit: string,
): Promise<Set<string>> {
  const out = await git('cherry', upstream, head, limit)
  return new Set(
    lines(out).flatMap((line) => (line.startsWith('- ') ? [line.slice(2).trim()] : [])),
  )
}

/** Commits of `limit..head` that `upstream` does not contain; the rest are its ancestors. */
export async function notInUpstream(
  git: TreeGit,
  upstream: string,
  head: string,
  limit: string,
): Promise<Set<string>> {
  return new Set(lines(await git('rev-list', '--no-merges', head, `^${limit}`, `^${upstream}`)))
}

const MAX_CONTENT_FILES = 200

/**
 * Every file `tip` changes against `from` has, at the default branch, exactly the contents it has
 * at `tip`: the change is already there, whatever commit landed it (a squash merge included).
 */
export async function contentOnDefault(
  git: TreeGit,
  defaultRef: string,
  from: string,
  tip: string,
): Promise<boolean> {
  const files = lines(await git('diff', '--name-only', '--no-renames', from, tip))
  if (files.length === 0 || files.length > MAX_CONTENT_FILES) return false
  const differing = await git(
    'diff',
    '--name-only',
    '--no-renames',
    defaultRef,
    tip,
    '--',
    ...files,
  )
  return lines(differing).length === 0
}

/** The files each commit of `from..to` changes, by commit. */
export async function filesByCommit(
  git: TreeGit,
  from: string,
  to: string,
): Promise<Map<string, string[]>> {
  const out = await git(
    'log',
    '--no-merges',
    '--no-renames',
    '--name-only',
    '--format=%x00%H',
    `${from}..${to}`,
  )
  const byCommit = new Map<string, string[]>()
  for (const chunk of out.split('\0').slice(1)) {
    const [sha, ...files] = chunk.split('\n') as [string, ...string[]]
    byCommit.set(sha, lines(files.join('\n')))
  }
  return byCommit
}

/** The default branch's name from `origin/HEAD`, or undefined when the clone does not know it. */
export async function defaultBranchName(git: TreeGit): Promise<string | undefined> {
  try {
    const ref = (await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).trim()
    return ref.replace(/^origin\//u, '') || undefined
  } catch {
    return undefined
  }
}

/** Whether `origin` has the branch: a failed lookup is unknown, an empty answer is proof. */
export async function remoteBranch(
  git: TreeGit,
  ref: string,
): Promise<'present' | 'missing' | 'unknown'> {
  try {
    const out = await git('ls-remote', '--heads', 'origin', `refs/heads/${ref}`)
    return out.trim() === '' ? 'missing' : 'present'
  } catch {
    return 'unknown'
  }
}

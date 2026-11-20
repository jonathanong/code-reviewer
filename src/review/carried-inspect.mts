import type { RunTextCommand } from '../gh-cli/index.mts'
import {
  contentOnDefault,
  defaultBranchName,
  filesByCommit,
  hasCommit,
  notInUpstream,
  patchEquivalent,
  rangeCommits,
  remoteBranch,
} from './carried-git.mts'
import type { BaseState, CarriedCommit, CarriedHome, CarriedInspection } from './carried-file.mts'
import { mergeBase, treeGit, type TreeGit } from './push-git.mts'

export type PullRef = { number: number; headSha: string }

export type CarriedArgs = {
  baseSha: string
  headSha: string
  /** The pull request's base branch; null when unknown. */
  baseRef: string | null
  /** Stack members below the pull request: its commits may be in them by identity or patch. */
  parents: PullRef[]
  /** Older open pull requests: only an identical patch counts, never a shared commit. */
  others: PullRef[]
}

const MAX_RANGE = 200
const MAX_PREFIX = 30
const MAX_FILES = 500

type Source = { ref: string; home: CarriedHome; ancestry: boolean }

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] as string

const empty = (problems: string[], defaultBranch: string | null = null): CarriedInspection => ({
  commits: [],
  commitsInRange: 0,
  files: [],
  filesTotal: 0,
  defaultBranch,
  base: 'none',
  problems,
})

async function fetchHeads(git: TreeGit, refs: readonly PullRef[], problems: string[]) {
  if (refs.length === 0) return
  try {
    await git('fetch', '--quiet', 'origin', ...refs.map((ref) => ref.headSha))
  } catch (error) {
    const list = refs.map((ref) => `#${ref.number}`).join(', ')
    problems.push(
      `The heads of ${list} could not be fetched, so they are not compared: ${firstLine(error)}`,
    )
  }
}

async function baseState(
  git: TreeGit,
  baseRef: string | null,
  name: string | undefined,
): Promise<BaseState> {
  if (baseRef === null) return 'none'
  return baseRef === name ? 'default' : remoteBranch(git, baseRef)
}

/**
 * Finds which commits of the pull request's diff range already exist in the default branch, in a
 * parent in the stack, or in an older open pull request, and which files only those commits touch.
 * Only git's proof counts: anything it cannot show leaves the commit as the pull request's own.
 */
export async function inspectCarried(
  run: RunTextCommand,
  tree: string,
  args: CarriedArgs,
): Promise<CarriedInspection> {
  const git = treeGit(run, tree)
  const problems: string[] = []
  const { headSha } = args
  try {
    const name = await defaultBranchName(git)
    if (name !== undefined) {
      await git('fetch', '--quiet', 'origin', name).catch((error: unknown) => {
        problems.push(`The default branch could not be fetched: ${firstLine(error)}`)
      })
    }
    await fetchHeads(git, args.parents, problems)
    await fetchHeads(git, args.others, problems)
    const base = await baseState(git, args.baseRef, name)
    const fork = await mergeBase(git, args.baseSha, headSha)
    if (fork === undefined) {
      return {
        ...empty([...problems, 'The base and the head share no ancestor.'], name ?? null),
        base,
      }
    }
    const range = await rangeCommits(git, fork, headSha, MAX_RANGE + 1)
    if (range.length > MAX_RANGE) {
      return {
        ...empty(
          [...problems, `More than ${MAX_RANGE} commits, so none were compared.`],
          name ?? null,
        ),
        base,
      }
    }
    const sources: Source[] = [
      ...(name === undefined
        ? []
        : [{ ref: `origin/${name}`, home: { kind: 'default' as const }, ancestry: true }]),
      ...args.parents.map((pull) => ({
        ref: pull.headSha,
        home: { kind: 'pull' as const, number: pull.number },
        ancestry: true,
      })),
      ...args.others.map((pull) => ({
        ref: pull.headSha,
        home: { kind: 'pull' as const, number: pull.number },
        ancestry: false,
      })),
    ]
    const found = await Promise.all(
      sources.map(async (source) => {
        if (!(await hasCommit(git, source.ref))) return undefined
        const [patch, fresh] = await Promise.all([
          patchEquivalent(git, source.ref, headSha, fork),
          source.ancestry ? notInUpstream(git, source.ref, headSha, fork) : undefined,
        ])
        return { source, patch, fresh }
      }),
    )
    const carried = new Map<string, CarriedCommit>()
    for (const entry of found) {
      if (entry === undefined) continue
      for (const { sha, subject } of range) {
        if (carried.has(sha)) continue
        const home = entry.source.home
        if (entry.patch.has(sha)) carried.set(sha, { sha, subject, home, how: 'patch' })
        else if (entry.fresh !== undefined && !entry.fresh.has(sha)) {
          carried.set(sha, { sha, subject, home, how: 'ancestor' })
        }
      }
    }
    const defaultSource = sources[0]
    if (name !== undefined && defaultSource !== undefined && carried.size < range.length) {
      for (let count = Math.min(range.length, MAX_PREFIX); count >= 1; count -= 1) {
        const tip = (range[count - 1] as { sha: string }).sha
        if (!(await contentOnDefault(git, defaultSource.ref, fork, tip))) continue
        for (const { sha, subject } of range.slice(0, count)) {
          if (!carried.has(sha))
            carried.set(sha, { sha, subject, home: defaultSource.home, how: 'content' })
        }
        break
      }
    }
    const byCommit = await filesByCommit(git, fork, headSha)
    const filesOf = (sha: string) => byCommit.get(sha) as string[]
    const own = new Set(
      range.filter(({ sha }) => !carried.has(sha)).flatMap(({ sha }) => filesOf(sha)),
    )
    const files = [...new Set([...carried.keys()].flatMap((sha) => filesOf(sha)))].filter(
      (file) => !own.has(file),
    )
    return {
      commits: range.flatMap(({ sha }) => carried.get(sha) ?? []),
      commitsInRange: range.length,
      files: files.slice(0, MAX_FILES),
      filesTotal: files.length,
      defaultBranch: name ?? null,
      base,
      problems,
    }
  } catch (error) {
    return empty([...problems, `Git could not find carried commits: ${firstLine(error)}`])
  }
}

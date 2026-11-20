import type { RunTextCommand } from '../gh-cli/index.mts'
import { fetchConversation, type PrConversation } from './context-query.mts'
import { apiFileReader, gitFileReader } from './rules/target-config.mts'
import { productionSources, type Sources } from './rules/sources.mts'
import { createGhReviewIo } from './github.mts'
import { localDiffBetween, localPullDiff } from './local-diff.mts'
import type { PullTarget } from './target.mts'
import { reviewableLines, type ChangedFile } from './triggers.mts'
import type { SinceDiff } from './plan.mts'
import { fetchDefaultBranch, fetchOpenPulls } from './stack-gh.mts'
import type { StackMember } from './stack.mts'
import type { TrustedAuthors } from './trust.mts'

/** The GitHub and git reads `prepareReview` needs, injectable for tests. */
export type PrepareIo = {
  headSha(): Promise<string>
  /** Logins whose `final-review` markers count. */
  trusted(): Promise<TrustedAuthors>
  /** The pull request diff: computed in `tree` when there is one, else asked of GitHub. */
  diff(tree?: string): Promise<string>
  /** The changed files with their changed line counts. */
  files(): Promise<ChangedFile[]>
  conversation(): Promise<PrConversation>
  compare(base: string, head: string): Promise<SinceDiff>
  compareDiff(base: string, head: string): Promise<string>
  /** The open pull requests and the default branch, for stack detection. */
  stackInput(): Promise<{ pr: number; pulls: StackMember[]; defaultBranch: string }>
  /**
   * The diff of a stack member against its own base, whose tip is `baseSha`: computed in `tree` by
   * local git when there is one, from the API otherwise or when git fails.
   */
  memberDiff(member: StackMember, baseSha: string, tree?: string): Promise<string>
  /** The commit checked out at `tree`. */
  treeHead(tree: string): Promise<string>
  /** Commit subjects touching `paths` in the year before `base`, from a local checkout. */
  /** Readers for the rule sources: the base of `tree` and the clones under `clones`. */
  ruleSources(args: { clones?: string; tree?: string; baseSha: string }): Promise<Sources>
  history(tree: string, base: string, paths: readonly string[]): Promise<string[] | undefined>
}

type CompareJson = {
  status?: string
  files?: { filename: string; additions?: number; deletions?: number }[]
}

const MAX_HISTORY_PATHS = 50
const MAX_COMPARE_FILES = 300

export function createGhPrepareIo(
  target: PullTarget,
  run: RunTextCommand,
  git: RunTextCommand,
  identity: () => Promise<string | undefined>,
  cloneRoot: string | undefined,
  configDir: string,
): PrepareIo {
  const io = createGhReviewIo(target, run, identity)
  const compareUrl = (base: string, head: string) =>
    `repos/${target.repo}/compare/${base}...${head}`
  return {
    headSha: () => io.headSha(),
    trusted: () => io.trustedAuthors(),
    async diff(tree) {
      if (tree === undefined) return io.diff()
      try {
        return await localPullDiff(target, run, git, tree)
      } catch {
        // A checkout that cannot fetch or diff still gets GitHub's diff, when GitHub has one.
        return io.diff()
      }
    },
    files: async () =>
      (await io.listFiles()).map((file) => ({
        path: file.filename,
        lines: (file.additions ?? 0) + (file.deletions ?? 0),
      })),
    conversation: () => fetchConversation(target, run),
    async compare(base, head) {
      let parsed: CompareJson
      try {
        parsed = JSON.parse(await run(['api', compareUrl(base, head)])) as CompareJson
      } catch {
        // An unknown base (force-pushed away and garbage-collected) is a rewrite.
        return { status: 'missing', paths: [], lines: 0 }
      }
      const files = parsed.files ?? []
      return {
        status: parsed.status ?? 'missing',
        paths: files.map((file) => file.filename),
        // The compare API lists at most 300 files; more means the since-diff is a rewrite.
        ...(files.length >= MAX_COMPARE_FILES ? { truncated: true } : {}),
        lines: reviewableLines(
          files.map((file) => ({
            path: file.filename,
            lines: (file.additions ?? 0) + (file.deletions ?? 0),
          })),
        ),
      }
    },
    async stackInput() {
      const [pulls, defaultBranch] = await Promise.all([
        fetchOpenPulls(run, target.repo),
        fetchDefaultBranch(run, target.repo),
      ])
      return { pr: target.pr, pulls, defaultBranch }
    },
    async memberDiff(member, baseSha, tree) {
      if (tree !== undefined) {
        try {
          return await localDiffBetween(git, tree, baseSha, member.headSha)
        } catch {
          // The commits cannot be fetched or compared locally; the API is the fallback.
        }
      }
      // The API refuses a diff above 300 files; the caller records that the diff was skipped.
      return run(['pr', 'diff', String(member.number), '-R', target.repo, '--color', 'never'])
    },
    compareDiff: (base, head) =>
      run(['api', compareUrl(base, head), '-H', 'Accept: application/vnd.github.diff']),
    async treeHead(tree) {
      return (await git(['-C', tree, 'rev-parse', 'HEAD'])).trim()
    },
    ruleSources: ({ clones, tree, baseSha }) =>
      productionSources({
        git,
        clones: clones ?? cloneRoot,
        tree,
        baseSha,
        repoId: target.repo,
        configDir,
        targetFile:
          tree === undefined
            ? apiFileReader(run, target.repo)
            : gitFileReader(tree, git, apiFileReader(run, target.repo)),
      }),
    async history(tree, base, paths) {
      try {
        const out = await git([
          '-C',
          tree,
          'log',
          '--since=12.months',
          '--format=%s',
          base,
          '--',
          ...paths.slice(0, MAX_HISTORY_PATHS),
        ])
        return out.split('\n').filter((line) => line.trim().length > 0)
      } catch {
        // The base commit is not in the checkout: history is unknown, not a failure.
        return undefined
      }
    },
  }
}

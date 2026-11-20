import type { RunTextCommand } from '../gh-cli/index.mts'
import { fetchConversation, type PrConversation } from './context-query.mts'
import { apiFileReader, gitFileReader } from './rules/target-config.mts'
import { productionSources, type Sources } from './rules/sources.mts'
import { createGhReviewIo } from './github.mts'
import { localPullDiff } from './local-diff.mts'
import type { PullTarget } from './target.mts'
import { reviewableLines, type ChangedFile } from './triggers.mts'
import type { SinceDiff } from './plan.mts'
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
  trustedAllowlist: readonly string[] = [],
  cloneRoot: string | undefined,
  configDir: string,
): PrepareIo {
  const io = createGhReviewIo(target, run, trustedAllowlist)
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

import type { RunTextCommand } from '../gh-cli/index.mts'
import { fetchConversation, type PrConversation } from './context-query.mts'
import { apiFileReader, gitFileReader } from './rules/target-config.mts'
import { productionSources, type Sources } from './rules/sources.mts'
import { createGhReviewIo } from './github.mts'
import { localDiffBetween, localPullDiff } from './local-diff.mts'
import type { CarriedInspection } from './carried-file.mts'
import { inspectCarried, type CarriedArgs } from './carried-inspect.mts'
import { lookupLinked, type LinkedLookup } from './links-query.mts'
import type { Ref } from './links-refs.mts'
import { inspectPush, type PushShas } from './push-inspect.mts'
import type { PushInspection } from './push-types.mts'
import { fetchPullCommits, type PullCommits } from './pull-commits.mts'
import { commitSubjects, docGrep } from './prepare-git.mts'
import type { PullTarget } from './target.mts'
import { reviewableLines, type ChangedFile } from './triggers.mts'
import type { SinceDiff } from './plan.mts'
import { fetchDefaultBranch, fetchOpenPulls } from './stack-gh.mts'
import type { StackMember } from './stack.mts'
import type { TrustedAuthors } from './trust.mts'

/** The GitHub and git reads `prepareReview` needs, injectable for tests. */
export type PrepareIo = {
  /** The pull request under review. */
  readonly self: Ref
  headSha(): Promise<string>
  /** Logins whose `final-review` markers count. */
  trusted(): Promise<TrustedAuthors>
  /** The pull request diff: computed in `tree` when there is one, else asked of GitHub. */
  diff(tree?: string): Promise<string>
  /** The changed files with their changed line counts. */
  files(): Promise<ChangedFile[]>
  conversation(): Promise<PrConversation>
  compare(base: string, head: string, generatedPaths?: readonly string[]): Promise<SinceDiff>
  compareDiff(base: string, head: string): Promise<string>
  /** The open pull requests and the default branch, for stack detection. */
  stackInput(): Promise<{ pr: number; pulls: StackMember[]; defaultBranch: string }>
  /**
   * The diff of a stack member against its own base, whose tip is `baseSha`: computed in `tree` by
   * local git when there is one, from the API otherwise or when git fails.
   */
  memberDiff(member: StackMember, baseSha: string, tree?: string): Promise<string>
  /** What was pushed since the last trusted review, classified by local git in `tree`. */
  push(tree: string, shas: PushShas): Promise<PushInspection>
  /** Which of the pull request's commits already exist elsewhere, by local git in `tree`; never rejects. */
  carried(tree: string, args: CarriedArgs): Promise<CarriedInspection>
  /** The pull request's commits as GitHub attributes them, bounded; rejects when GitHub fails. */
  pullCommits(): Promise<PullCommits>
  /** The merged pull request whose head branch is `ref`, if GitHub knows one. */
  mergedPull(ref: string): Promise<number | undefined>
  /** The state of pull requests and issues this one names, in one lookup; never rejects. */
  linked(refs: readonly Ref[]): Promise<LinkedLookup>
  /** The full messages of the pull request's own commits, from local history in `tree`. */
  commitMessages(tree: string, baseSha: string, headSha: string): Promise<string[]>
  /** The commit checked out at `tree`. */
  treeHead(tree: string): Promise<string>
  /** Readers for the rule sources: the base of `tree` and the clones under `clones`. */
  ruleSources(args: { clones?: string; tree?: string; baseSha: string }): Promise<Sources>
  /** Commit subjects touching `paths` in the year before `base`, from a local checkout. */
  history(tree: string, base: string, paths: readonly string[]): Promise<string[] | undefined>
  /** Runs `git` with `args` in `tree`; resolves `''` when the search matched nothing (exit 1). */
  docGrep(tree: string, args: string[]): Promise<string>
}

type CompareJson = {
  status?: string
  files?: { filename: string; additions?: number; deletions?: number }[]
}

const MAX_COMPARE_FILES = 300

const changedFile = (file: { filename: string; additions?: number; deletions?: number }) => ({
  path: file.filename,
  lines: (file.additions ?? 0) + (file.deletions ?? 0),
})

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
    self: { repo: target.repo, number: target.pr },
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
    files: async () => (await io.listFiles()).map(changedFile),
    conversation: async () =>
      fetchConversation(target, run, { trusted: await io.trustedAuthors() }),
    async compare(base, head, generatedPaths) {
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
        lines: reviewableLines(files.map(changedFile), generatedPaths),
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
    push: (tree, shas) => inspectPush(git, tree, shas),
    carried: (tree, args) => inspectCarried(git, tree, args),
    linked: (refs) => lookupLinked(run, target.repo, refs),
    pullCommits: () => fetchPullCommits(run, target.repo, target.pr),
    async commitMessages(tree, baseSha, headSha) {
      const out = await git([
        '-C',
        tree,
        'log',
        '--no-merges',
        '--max-count=100',
        '--format=%B%x00',
        `${baseSha}..${headSha}`,
      ])
      return out.split('\0').filter((message) => message.trim() !== '')
    },
    async mergedPull(ref) {
      const [owner] = target.repo.split('/') as [string]
      const out = await run([
        'api',
        `repos/${target.repo}/pulls?state=closed&head=${owner}:${encodeURIComponent(ref)}&per_page=10`,
        '-q',
        '[.[] | select(.merged_at != null) | .number] | first // empty',
      ])
      const number = Number(out.trim())
      return Number.isInteger(number) && number > 0 ? number : undefined
    },
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
    history: (tree, base, paths) => commitSubjects(git, tree, base, paths),
    docGrep: (tree, args) => docGrep(git, tree, args),
  }
}

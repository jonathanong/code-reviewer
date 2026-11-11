import type { RunTextCommand } from '../gh-cli/index.mts'
import { fetchConversation, type PrConversation } from './context-query.mts'
import { createGhFinalReviewIo, type PullTarget } from './github.mts'
import type { SinceDiff } from './plan.mts'

/** The GitHub and git reads `prepareReview` needs, injectable for tests. */
export type PrepareIo = {
  headSha(): Promise<string>
  diff(): Promise<string>
  paths(): Promise<string[]>
  conversation(): Promise<PrConversation>
  compare(base: string, head: string): Promise<SinceDiff>
  compareDiff(base: string, head: string): Promise<string>
  /** Commit subjects touching `paths` in the year before `base`, from a local checkout. */
  history(tree: string, base: string, paths: readonly string[]): Promise<string[]>
}

type CompareJson = {
  status?: string
  files?: { filename: string; additions?: number; deletions?: number }[]
}

const MAX_HISTORY_PATHS = 50

export function createGhPrepareIo(
  target: PullTarget,
  run: RunTextCommand,
  git: RunTextCommand,
): PrepareIo {
  const io = createGhFinalReviewIo(target, run)
  const compareUrl = (base: string, head: string) =>
    `repos/${target.repo}/compare/${base}...${head}`
  return {
    headSha: () => io.headSha(),
    diff: () => io.diff(),
    paths: async () => (await io.listFiles()).map((file) => file.filename),
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
        lines: files.reduce((sum, file) => sum + (file.additions ?? 0) + (file.deletions ?? 0), 0),
      }
    },
    compareDiff: (base, head) =>
      run(['api', compareUrl(base, head), '-H', 'Accept: application/vnd.github.diff']),
    async history(tree, base, paths) {
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
    },
  }
}

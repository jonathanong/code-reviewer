import { pool } from '../run/pool.mts'
import {
  type FileRanges,
  isoDate,
  parseBlame,
  parseDiffRanges,
  prNumber,
  shortSubject,
} from './git-history-parse.mts'
import type { ContextDeps, ContextInput, ContextSection, SectionBuilder } from './types.mts'

/** Files blamed at most, in diff order; one `git blame` call each, so also the call cap. */
export const MAX_FILES = 20
/** Hunks blamed per file; the rest of the file's hunks are not. */
export const MAX_HUNKS_PER_FILE = 20
/** Old-side lines blamed per file at most; a file past it (a deleted large file) is skipped. */
export const MAX_LINES_PER_FILE = 3000
/** Commits listed per file. */
export const MAX_COMMITS_PER_FILE = 5
const BLAME_JOBS = 4
const BLAME_TIMEOUT_MS = 30_000

const GENERATED_DIR = /(^|\/)(dist|build|vendor|node_modules|__generated__|__snapshots__)\//u
const GENERATED_FILE =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|go\.sum)$|\.(lock|min\.js|min\.css|snap|map)$|\.generated\./u
const generated = (path: string): boolean => GENERATED_DIR.test(path) || GENERATED_FILE.test(path)

const git = (input: ContextInput, deps: ContextDeps, args: string[]) =>
  deps.exec('git', ['-C', input.tree, ...args], { timeoutMs: BLAME_TIMEOUT_MS })

async function blame(
  input: ContextInput,
  deps: ContextDeps,
  base: string,
  file: FileRanges,
): Promise<string[]> {
  const ranges = file.ranges.slice(0, MAX_HUNKS_PER_FILE)
  const flags = ranges.flatMap((r) => ['-L', `${r.start},${r.start + r.count - 1}`])
  const out = await git(input, deps, ['blame', '--porcelain', ...flags, base, '--', file.path])
  const commits = parseBlame(out)
  const lines = commits.slice(0, MAX_COMMITS_PER_FILE).map((commit) => {
    const pr = prNumber(commit.subject)
    const prefix = `- \`${commit.sha.slice(0, 7)}\` ${isoDate(commit.time)}`
    return `${prefix} ${shortSubject(commit.subject)}${pr === null ? '' : ` (PR #${pr})`}, ${commit.lines} line(s)`
  })
  if (commits.length > MAX_COMMITS_PER_FILE) {
    lines.push(`- ${commits.length - MAX_COMMITS_PER_FILE} older commit(s) not listed`)
  }
  const unblamed = file.ranges.length - ranges.length
  if (unblamed > 0) lines.push(`- ${unblamed} more hunk(s) not blamed`)
  return lines
}

/** For the lines the pull request changes or deletes, the earlier commits that last touched them. */
export const changedLineHistory: SectionBuilder = {
  name: 'changed-line-history',
  async build(input, deps): Promise<ContextSection | null> {
    const base = (await git(input, deps, ['merge-base', input.baseSha, input.headSha])).trim()
    const diff = await git(input, deps, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-renames',
      '-U0',
      `${input.baseSha}...${input.headSha}`,
    ])
    const all = parseDiffRanges(diff).filter((file) => !generated(file.path))
    if (all.length === 0) return null
    const files = all.slice(0, MAX_FILES)
    const parts: string[] = files.map(() => '')
    await pool(
      files.map((file, index) => ({ file, index })),
      BLAME_JOBS,
      async ({ file, index }) => {
        const total = file.ranges.reduce((sum, range) => sum + range.count, 0)
        let result: string[]
        if (total > MAX_LINES_PER_FILE) result = [`- skipped: ${total} old lines`]
        else {
          result = await blame(input, deps, base, file).catch((error: unknown) => [
            `- not blamed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`,
          ])
        }
        parts[index] = [`### ${file.path}`, ...result].join('\n')
      },
    )
    if (all.length > files.length) {
      parts.push(`${all.length - files.length} more changed file(s) not blamed.`)
    }
    return { title: 'Changed-line history', body: parts.join('\n\n') }
  },
}

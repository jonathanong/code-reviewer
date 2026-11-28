import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import { splitDiff } from './diff-files.mts'
import { isSourcePath } from './triggers.mts'

/** JavaScript and TypeScript sources; the only files the ast-grep rules cover. */
const SCANNED_RE = /\.[cm]?[jt]sx?$/u

/** Test support the shared test-path rule misses: `test-helpers/`, `test-cases/`, `tests.rs`. */
const SUPPORT_RE = /(?:^|\/)(?:test-[^/]+|[^/]*-tests?)\//u

/** The changed lines of one file's diff, as line numbers in the head file and in the base file. */
export type ChangedLines = { added: number[]; removed: number[] }

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u

/** Reads only the hunk headers and the `+`/`-`/space markers of a plain unified diff of one file. */
export function changedLines(fileDiff: string): ChangedLines {
  const lines: ChangedLines = { added: [], removed: [] }
  let left = 0
  let right = 0
  let inHunk = false
  for (const line of fileDiff.split('\n')) {
    const hunk = HUNK.exec(line)
    if (hunk !== null) {
      left = Number(hunk[1])
      right = Number(hunk[2])
      inHunk = true
    } else if (!inHunk || line.startsWith('\\')) continue
    else if (line.startsWith('+')) lines.added.push(right++)
    else if (line.startsWith('-')) lines.removed.push(left++)
    // An empty line is context too: `diff.suppressBlankEmpty` drops its leading space.
    else if (line.startsWith(' ') || line === '') {
      left += 1
      right += 1
    }
  }
  return lines
}

type Range = { start: { line: number }; end: { line: number } }

/** One match of `ast-grep scan --json=compact`; lines are 0-based. */
export type AstMatch = {
  file: string
  range: Range
  metaVariables?: { single?: Record<string, { range: Range } | undefined> }
}

/** The matches in ast-grep's JSON output. */
export function parseAstMatches(output: string): AstMatch[] {
  const parsed: unknown = JSON.parse(output)
  return Array.isArray(parsed) ? (parsed as AstMatch[]) : []
}

/**
 * True when a match covers a changed line. The `.query(` rule reports its first argument (`Q`), so
 * a change to the parameters after it does not count.
 */
export function matchTouches(match: AstMatch, lines: ReadonlySet<number>): boolean {
  const { start, end } = match.metaVariables?.single?.Q?.range ?? match.range
  for (let line = start.line + 1; line <= end.line + 1; line += 1) {
    if (lines.has(line)) return true
  }
  return false
}

/** The files, relative to `root`, with a match that covers one of their changed lines. */
export function filesWithChangedMatches(
  matches: readonly AstMatch[],
  root: string,
  changed: ReadonlyMap<string, ReadonlySet<number>>,
): Set<string> {
  const found = new Set<string>()
  for (const match of matches) {
    const path = relative(root, match.file)
    const lines = changed.get(path)
    if (lines !== undefined && matchTouches(match, lines)) found.add(path)
  }
  return found
}

export type SqlScanIo = {
  /** Runs `ast-grep` with `args` and returns stdout; rejects with `code: 'ENOENT'` when it is not installed. */
  astGrep(args: string[]): Promise<string>
  /** A file's text at `sha` in `tree`; undefined when it does not exist there. */
  fileAt(tree: string, sha: string, path: string): Promise<string | undefined>
}

export type SqlScan = { paths: string[]; skipped?: string }

const ESCAPE = /\\(?:([0-7]{3})|(.))/gu
const NAMED: Record<string, number> = { t: 9, n: 10, r: 13, a: 7, b: 8, f: 12, v: 11 }

/**
 * Git quotes a path holding a non-ASCII byte, tab, quote or backslash: `caf\303\251.ts`. This
 * decodes the escapes back to the file name; an ordinary path has none and is returned as it is.
 */
export function unquoteGitPath(path: string): string {
  if (!path.includes('\\')) return path
  const bytes: number[] = []
  let last = 0
  for (const match of path.matchAll(ESCAPE)) {
    bytes.push(...Buffer.from(path.slice(last, match.index)))
    const [whole, octal, other] = match
    bytes.push(
      octal === undefined
        ? (NAMED[other as string] ?? (other as string).charCodeAt(0))
        : parseInt(octal, 8),
    )
    last = (match.index as number) + whole.length
  }
  bytes.push(...Buffer.from(path.slice(last)))
  return Buffer.from(bytes).toString('utf8')
}

/** The path a file had at the base: the `rename from` of a renamed file, otherwise its own path. */
function pathAtBase(fileDiff: string, path: string): string {
  const renamed = /^rename from (.+)$/mu.exec(fileDiff)
  return renamed?.[1] === undefined ? path : unquoteGitPath(renamed[1].replace(/^"(.*)"$/u, '$1'))
}

const skippedBecause = (error: unknown): string =>
  (error as { code?: unknown }).code === 'ENOENT'
    ? 'ast-grep was not found'
    : `ast-grep failed: ${(error as Error).message.split('\n')[0]}`

async function scan(
  io: SqlScanIo,
  config: string,
  root: string,
  changed: ReadonlyMap<string, ReadonlySet<number>>,
): Promise<Set<string>> {
  if (changed.size === 0) return new Set()
  const files = [...changed.keys()].map((path) => join(root, path))
  const output = await io.astGrep(['scan', '--config', config, '--json=compact', ...files])
  return filesWithChangedMatches(parseAstMatches(output), root, changed)
}

/**
 * The hand-written, non-test JavaScript and TypeScript files of `patch` that change SQL by
 * construction (see `ast-rules/sql`): a match of an ast-grep rule that covers an added line, found
 * in the file at `tree`'s head, or a removed line, found in the file at `base`. The reviewer parses
 * no source itself; ast-grep does. A missing or failing ast-grep gives `skipped` and no paths.
 */
export async function scanSqlPaths(
  io: SqlScanIo,
  input: {
    patch: string
    tree: string | undefined
    base: string
    config: string
    generatedPaths: readonly string[]
  },
): Promise<SqlScan> {
  const { tree } = input
  const head = new Map<string, Set<number>>()
  const removed = new Map<string, { lines: Set<number>; from: string }>()
  for (const file of splitDiff(input.patch)) {
    const path = unquoteGitPath(file.path)
    if (!SCANNED_RE.test(path) || SUPPORT_RE.test(path)) continue
    if (!isSourcePath(path, input.generatedPaths)) continue
    const lines = changedLines(file.text)
    if (lines.added.length > 0) head.set(path, new Set(lines.added))
    if (lines.removed.length > 0) {
      removed.set(path, { lines: new Set(lines.removed), from: pathAtBase(file.text, path) })
    }
  }
  if (head.size === 0 && removed.size === 0) return { paths: [] }
  if (tree === undefined) return { paths: [], skipped: 'there is no local checkout' }
  const present = new Map([...head].filter(([path]) => existsSync(join(tree, path))))
  const dir = mkdtempSync(join(tmpdir(), 'sql-base-'))
  try {
    const found = await scan(io, input.config, tree, present)
    const base = new Map<string, Set<number>>()
    for (const [path, { lines, from }] of removed) {
      // Written under the new path, so ast-grep's matches map back to the path the diff names.
      const text = await io.fileAt(tree, input.base, from)
      if (text === undefined) continue
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), text)
      base.set(path, lines)
    }
    for (const path of await scan(io, input.config, dir, base)) found.add(path)
    return { paths: [...found].sort() }
  } catch (error) {
    return { paths: [], skipped: skippedBecause(error) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

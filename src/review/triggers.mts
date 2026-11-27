import { matchesGlob } from 'node:path'

/** Path classification behind pillar dispatch; see skills/review/references/dispatch.md. */

const DOC_RE = /\.(?:md|mdx|markdown|txt|rst|adoc)$/iu
const TEST_RE =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:(?:^|\/)(?:__tests__|tests?|fixtures|__snapshots__)\/)|(?:_test\.(?:go|rs|py)$)|(?:Tests?\.(?:swift|cs|kt)$)/u

/**
 * Files that direct agents are code: a skill, an agent definition, and `AGENTS.md` or `CLAUDE.md`
 * change what an agent does, so a pull request that touches only them is not a docs-only change.
 */
const INSTRUCTION_RE =
  /(?:(?:^|\/)(?:SKILL|AGENTS|CLAUDE)\.md$)|(?:(?:^|\/)(?:skills|agents|plugins|\.claude)\/(?:.*\/)?[^/]+\.md$)/u

/** SQL files and migrations; the plan's `sqlPaths` add to these. */
const SQL_RE = /\.sql$|(?:^|\/)migrations?\//iu

/** Build and dependency manifests that look like docs (requirements.txt) are code, not docs. */
const MANIFEST_RE = /(?:^|\/)(?:requirements[^/]*|CMakeLists)\.txt$/iu

const SECURITY_RES: readonly RegExp[] = [
  /auth|session|token|permission|crypto|secret|password|credential|oauth|jwt/iu,
  /^\.github\/workflows\//u,
  /(?:^|\/)action\.ya?ml$/u,
  /(?:^|\/)Dockerfile[^/]*$|\.dockerfile$/iu,
  /\.(?:sh|bash|zsh|sql)$/u,
  /(?:^|\/)migrations?\//iu,
  /handler|route|parser|upload|webhook|middleware/iu,
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.(?:toml|lock)|go\.(?:mod|sum)|requirements[^/]*\.txt|poetry\.lock|Package\.resolved|Gemfile(?:\.lock)?)$|\.csproj$/u,
]

const LOCKFILES: ReadonlySet<string> = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'Package.resolved',
  'packages.lock.json',
  'Gemfile.lock',
  'poetry.lock',
  'uv.lock',
  'go.sum',
  '.terraform.lock.hcl',
])

const MANIFESTS: ReadonlySet<string> = new Set([
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'Gemfile',
  'Package.swift',
])
const MANIFEST_NAME_RES: readonly RegExp[] = [/^requirements[^/]*\.txt$/u, /\.csproj$/u]
/** Dependabot bumps GitHub Actions in workflow files. */
const WORKFLOW_RE = /^\.github\/workflows\/[^/]+\.ya?ml$/u

const GENERATED_RES: readonly RegExp[] = [
  /\.(?:min\.(?:js|css)|map)$/u,
  /\.snap$|(?:^|\/)__snapshots__\//u,
  /(?:^|\/)(?:dist|build|generated|__generated__|vendor|node_modules)\//u,
  /\.(?:generated|gen)\.[^/]+$|\.pb\.go$|_pb2\.py$/u,
]

/** True when the file's basename is a dependency lockfile. */
export function isLockfile(path: string): boolean {
  return LOCKFILES.has(basename(path))
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

const matchesAny = (path: string, globs: readonly string[]) =>
  globs.some((glob) => matchesGlob(path, glob))

/**
 * Lockfiles, build output, snapshots, and code generators' files: not worth reviewing line by
 * line. `extra` are configured globs that count too.
 */
export function isGenerated(path: string, extra: readonly string[] = []): boolean {
  return isLockfile(path) || GENERATED_RES.some((re) => re.test(path)) || matchesAny(path, extra)
}

/** Dependency manifests, lockfiles, and workflow files: what a Dependabot pull request edits. */
export function isDependencyFile(path: string): boolean {
  const name = basename(path)
  return (
    isLockfile(path) ||
    MANIFESTS.has(name) ||
    MANIFEST_NAME_RES.some((re) => re.test(name)) ||
    WORKFLOW_RE.test(path)
  )
}

/** A changed file; `renamed` is set when GitHub reports the file moved from another path. */
export type ChangedFile = { path: string; lines: number; renamed?: boolean }

/** Changed lines outside generated files. */
export function reviewableLines(
  files: readonly ChangedFile[],
  generatedPaths: readonly string[] = [],
): number {
  return files.reduce(
    (sum, file) => sum + (isGenerated(file.path, generatedPaths) ? 0 : file.lines),
    0,
  )
}

/** True for a file with a documentation extension, instruction files included. */
export function isDocFile(path: string): boolean {
  return DOC_RE.test(path) && !MANIFEST_RE.test(path)
}

/** True for a markdown file that directs an agent; see `INSTRUCTION_RE`. */
export function isInstructionFile(path: string): boolean {
  return INSTRUCTION_RE.test(path)
}

/** Documentation a pull request may change without changing behaviour; an instruction file is not. */
export function isDocPath(path: string): boolean {
  return isDocFile(path) && !isInstructionFile(path)
}

/** True for a SQL file or a migration, or a path matching one of the configured `extra` globs. */
export function isSqlPath(path: string, extra: readonly string[] = []): boolean {
  return SQL_RE.test(path) || matchesAny(path, extra)
}

export function isTestPath(path: string): boolean {
  return TEST_RE.test(path)
}

export function isDocsOnly(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every(isDocPath)
}

/** True when every path is a test or a doc, so no runtime consumer can break. */
export function isTestOrDocsOnly(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every((path) => isTestPath(path) || isDocPath(path))
}

/** The changed paths that trigger the security pillar; `extra` are configured globs that trigger it too. */
export function securityTriggers(
  paths: readonly string[],
  extra: readonly string[] = [],
): string[] {
  return paths.filter(
    (path) =>
      !isDocFile(path) && (SECURITY_RES.some((re) => re.test(path)) || matchesAny(path, extra)),
  )
}

const HISTORY_RE = /^(?:revert\b|hotfix\b)|\brevert(?:s|ed)?\b|\bhotfix\b/iu

/** Commit subjects that mark a revert or hotfix precedent on the changed files. */
export function historyHits(subjects: readonly string[]): string[] {
  return subjects.filter((subject) => HISTORY_RE.test(subject))
}

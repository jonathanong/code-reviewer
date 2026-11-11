/** Path classification behind pillar dispatch; see skills/final-review/references/dispatch.md. */

const DOC_RE = /\.(?:md|mdx|markdown|txt|rst|adoc)$/iu
const TEST_RE =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:(?:^|\/)(?:__tests__|tests?|fixtures|__snapshots__)\/)|(?:_test\.(?:go|rs|py)$)|(?:Tests?\.(?:swift|cs|kt)$)/u

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

export function isDocPath(path: string): boolean {
  return DOC_RE.test(path) && !MANIFEST_RE.test(path)
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

/** The changed paths that trigger the security pillar. */
export function securityTriggers(paths: readonly string[]): string[] {
  return paths.filter((path) => !isDocPath(path) && SECURITY_RES.some((re) => re.test(path)))
}

const HISTORY_RE = /^(?:revert\b|hotfix\b)|\brevert(?:s|ed)?\b|\bhotfix\b/iu

/** Commit subjects that mark a revert or hotfix precedent on the changed files. */
export function historyHits(subjects: readonly string[]): string[] {
  return subjects.filter((subject) => HISTORY_RE.test(subject))
}

import { matchesGlob } from 'node:path'

import { isDependencyFile, isDocFile, isTestPath } from '../review/triggers.mts'

/**
 * Paths whose change a human should read the review for before it posts. This is narrower than the
 * dispatcher's security triggers, which decide only whether the security pillar runs: manifests,
 * lockfiles, scripts and names like handler or parser are left out, because a held review nobody
 * needs to read trains people to post without reading.
 *
 * A component under an `auth/` directory still counts: a login button is worth a look.
 */
const RISKY_RES: readonly RegExp[] = [
  // Auth and secrets. `author` is not auth; `authorize` and `authorization` are.
  /auth(?!or(?!i[sz]))|session|permission|crypto|secret|password|credential|jwt/iu,
  // Database schema.
  /(?:^|\/)migrations?\//iu,
  /\.sql$/iu,
  // Infrastructure.
  /\.(?:tf|tofu|tfvars)$/iu,
  /(?:^|\/)Dockerfile[^/]*$/u,
  /\.dockerfile$/iu,
  /(?:^|[/._-])iam(?:[/._-]|$)/iu,
]

/** CI that runs with credentials: the workflow files themselves, and actions. */
const CI_RES: readonly RegExp[] = [
  /^\.github\/workflows\/[^/]+\.ya?ml$/u,
  /(?:^|\/)action\.ya?ml$/u,
]

/** Stories and shell scripts are never risky by default, whatever their name or directory. */
const NOT_SOURCE_RE = /\.stories\.|\.(?:sh|bash|zsh)$/iu

/**
 * The risky paths of a change, in input order. Test and doc paths never count. `patterns` are
 * globs that replace the default categories; an empty list means nothing is risky.
 */
export function riskyPaths(paths: readonly string[], patterns?: readonly string[]): string[] {
  return paths.filter((path) => {
    if (isTestPath(path) || isDocFile(path)) return false
    if (patterns !== undefined) return patterns.some((pattern) => matchesGlob(path, pattern))
    if (CI_RES.some((re) => re.test(path))) return true
    if (NOT_SOURCE_RE.test(path) || isDependencyFile(path)) return false
    return RISKY_RES.some((re) => re.test(path))
  })
}

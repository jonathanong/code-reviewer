import { matchesGlob } from 'node:path'

import { isDocPath, isTestPath } from '../review/triggers.mts'

/**
 * Paths whose change a human should read the review for before it posts. This is narrower than the
 * dispatcher's security triggers, which decide only whether the security pillar runs: manifests,
 * lockfiles, scripts and names like handler or parser are left out, because a held review nobody
 * needs to read trains people to post without reading.
 *
 * A component under an `auth/` directory still counts: a login button is worth a look.
 */
const RISKY_RES: readonly RegExp[] = [
  // Auth and secrets; `author` is not auth. Stories are not source.
  /^(?!.*\.stories\.).*(?:auth(?!or)|session|permission|crypto|secret|password|credential|jwt)/iu,
  // CI that runs with credentials: the workflow files themselves, and actions.
  /^\.github\/workflows\/[^/]+\.ya?ml$/u,
  /(?:^|\/)action\.ya?ml$/u,
  // Database schema.
  /(?:^|\/)migrations?\//u,
  /\.sql$/iu,
  // Infrastructure.
  /\.(?:tf|tofu|tfvars)$/iu,
  /(?:^|\/)Dockerfile[^/]*$/u,
  /\.dockerfile$/iu,
  /(?:^|[/._-])iam(?:[/._-]|$)/iu,
]

/**
 * The risky paths of a change, in input order. Test and doc paths never count. `patterns` are
 * globs that replace the default categories; an empty list means nothing is risky.
 */
export function riskyPaths(paths: readonly string[], patterns?: readonly string[]): string[] {
  return paths.filter((path) => {
    if (isTestPath(path) || isDocPath(path)) return false
    return patterns === undefined
      ? RISKY_RES.some((re) => re.test(path))
      : patterns.some((pattern) => matchesGlob(path, pattern))
  })
}

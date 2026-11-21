import { isDocPath, isGenerated, isLockfile, isTestPath } from '../../triggers.mts'
import type { Kind } from './types.mts'

/** Lint, format and compiler configuration: what can explain a mechanical change. */
const TOOL_CONFIG_RE =
  /(?:^|\/)(?:\.oxlintrc[^/]*|\.oxfmtrc[^/]*|eslint\.config\.[^/]+|\.eslintrc[^/]*|\.prettierrc[^/]*|prettier\.config\.[^/]+|(?:ts|js)config[^/]*\.json|\.?rustfmt\.toml|\.?clippy\.toml|biome\.jsonc?|\.editorconfig|\.?ruff\.toml|\.golangci\.ya?ml|\.swiftlint\.ya?ml|\.stylelintrc[^/]*|stylelint\.config\.[^/]+|\.rubocop\.ya?ml)$/u
const OTHER_CONFIG_RE = /(?:^|\/)package\.json$|\.(?:ya?ml|toml|ini)$/u

export const isToolConfig = (path: string): boolean => TOOL_CONFIG_RE.test(path)

/** Reuses the light/full mode's lockfile, generated, test and docs classification. */
export function kindOf(path: string): Kind {
  if (isLockfile(path)) return 'lockfile'
  if (isGenerated(path)) return 'generated'
  if (isTestPath(path)) return 'test'
  if (isDocPath(path)) return 'docs'
  if (isToolConfig(path) || OTHER_CONFIG_RE.test(path)) return 'config'
  return 'source'
}

/** The first path segment; a file at the root is `(root)`. */
export function topDir(path: string): string {
  const slash = path.indexOf('/')
  return slash === -1 ? '(root)' : path.slice(0, slash)
}

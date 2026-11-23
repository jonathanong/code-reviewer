import { kindOf } from './context/change-shape/classify.mts'
import type { Kind } from './context/change-shape/types.mts'
import type { Impact } from './impact.mts'
import { isDependencyFile, isTestPath } from './triggers.mts'

const SCOPES = [
  'source',
  'tests',
  'docs',
  'agent direction',
  'dependencies',
  'generated paths',
  'ci',
  'config',
] as const
type Scope = (typeof SCOPES)[number]

const BY_KIND: Record<Kind, Scope> = {
  source: 'source',
  test: 'tests',
  docs: 'docs',
  config: 'config',
  lockfile: 'dependencies',
  generated: 'generated paths',
}

const MAX_SCOPES = 4

const AGENT_RE =
  /(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$|(?:^|\/)skills\/(?:[^/]+\/)*references\/|(?:^|\/)evals\//u
const CI_RE = /^\.github\/(?:workflows|actions)\//u

function scopeOf(path: string): Scope {
  if (AGENT_RE.test(path)) return 'agent direction'
  if (CI_RE.test(path)) return 'ci'
  if (isDependencyFile(path)) return 'dependencies'
  if (isTestPath(path)) return 'tests'
  return BY_KIND[kindOf(path)]
}

/**
 * The kinds of file a pull request changes, from its paths alone: the distinct ones, most files
 * first, or `<kind>-only` when every file is of one kind other than source. Nothing for no files.
 */
export function scopeLabel(paths: readonly string[]): string | undefined {
  const counts = new Map<Scope, number>()
  for (const scope of paths.map(scopeOf)) counts.set(scope, (counts.get(scope) ?? 0) + 1)
  const kinds = [...counts]
    .sort(([a, x], [b, y]) => y - x || SCOPES.indexOf(a) - SCOPES.indexOf(b))
    .map(([scope]) => scope)
  const [only] = kinds
  if (only === undefined) return undefined
  if (kinds.length === 1 && only !== 'source')
    return `${only === 'tests' ? 'test' : only.replace(' ', '-')}-only`
  return kinds.slice(0, MAX_SCOPES).join(', ')
}

/** The review header's one line naming the pull request's class; empty when neither part is known. */
export function classLine(paths: readonly string[], impact: Impact | undefined): string[] {
  const parts = [
    impact === undefined
      ? undefined
      : impact.basis === undefined
        ? impact.kind
        : `${impact.kind} (${impact.basis})`,
    scopeLabel(paths),
  ].filter((part) => part !== undefined)
  return parts.length === 0 ? [] : [`**Class:** ${parts.join(' · ')}`]
}

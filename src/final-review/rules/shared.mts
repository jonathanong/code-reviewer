/** A shared rule source read from a local clone's default branch. */
export type SharedSource = {
  name: string
  /** Directory of the clone under the clone root. */
  cloneDir: string
  /** Path prefix in the clone; staged paths drop it. */
  prefix: string
  /** Instruction files relative to the prefix. */
  instructions?: string[]
  /** With a `plugins/` layout: plugin to its allowed skills, or `*` for all. */
  allow?: Record<string, readonly string[] | '*'>
  /** Other files (relative to the clone root) staged as references. */
  references?: string[]
}

/** Which vouchington-tooling skills the final reviewer sees. Edit here to widen or narrow it. */
export const TOOLING_ALLOW: Record<string, readonly string[] | '*'> = {
  'vouchington-testing': '*',
  'vouchington-database': '*',
  'vouchington-workflow': [
    'agent-workflow',
    'dependabot',
    'git-commit-checklist',
    'github-actions-authoring',
    'github-actions-checklist',
    'package-json-checklist',
    'pr-description',
    'review-ci-logs',
    'static-analysis-checklist',
  ],
}

export const SHARED_SOURCES: readonly SharedSource[] = [
  {
    name: 'no-mistakes-rules',
    cloneDir: 'no-mistakes',
    prefix: 'plugins/no-mistakes-rules/',
    instructions: ['AGENTS.md'],
  },
  {
    name: 'vouchington-tooling',
    cloneDir: 'vouchington-tooling',
    prefix: 'plugins/',
    allow: TOOLING_ALLOW,
    references: ['plugins/vouchington-workflow/skills/agent-workflow/references/review.md'],
  },
]

const SKILL = /^(?:([^/]+)\/)?skills\/([^/]+)\/SKILL\.md$/u

function skillAllowed(source: SharedSource, rel: string): boolean {
  const match = SKILL.exec(rel)
  if (match === null) return false
  const [, plugin, skill] = match
  if (source.allow === undefined) return plugin === undefined
  const allowed = plugin === undefined ? undefined : source.allow[plugin]
  return allowed !== undefined && (allowed === '*' || allowed.includes(skill as string))
}

/** The clone paths (full, sorted) a source stages. */
export function sharedPaths(source: SharedSource, all: readonly string[]): string[] {
  const wanted = new Set([
    ...(source.instructions ?? []).map((path) => `${source.prefix}${path}`),
    ...(source.references ?? []),
  ])
  return all
    .filter(
      (path) =>
        wanted.has(path) ||
        (path.startsWith(source.prefix) && skillAllowed(source, path.slice(source.prefix.length))),
    )
    .sort()
}

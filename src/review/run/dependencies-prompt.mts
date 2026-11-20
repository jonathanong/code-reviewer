import { join } from 'node:path'

import { DEPENDENCIES_FILE, type Dependency } from '../dependency.mts'

/**
 * What `prepare` already found this pull request depends on, so the verifier lists only what it
 * adds. Empty without any, so the prompt of a pull request with no dependency does not change.
 */
export function dependenciesLines(
  dependencies: readonly Dependency[] | undefined,
  out: string,
): string[] {
  if (dependencies === undefined || dependencies.length === 0) return []
  const known = dependencies.map((entry) => `- ${entry.on} (${entry.kind}, ${entry.state})`)
  return [
    '## Known dependencies',
    `\`prepare\` found these in the description, the commit messages and the stack (\`${join(out, DEPENDENCIES_FILE)}\`). They are already reported, so list in \`dependencies\` only what you add. Apply the Dependencies rule.`,
    known.join('\n'),
  ]
}

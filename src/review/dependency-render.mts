import type { Dependency } from './dependency.mts'

/** The one line a dependency takes in the posted review, the report and the explanation. */
export const dependencyLine = (entry: Dependency) => `- ${entry.on} (${entry.state}): ${entry.why}`

/**
 * The "Depends on" block of the review body: what this change needs first and has not landed.
 * Empty when everything it depends on has merged, so such a body does not change.
 */
export function dependsOnSection(dependencies: readonly Dependency[] | undefined): string[] {
  const waiting = (dependencies ?? []).filter((entry) => entry.state !== 'merged')
  if (waiting.length === 0) return []
  return [`**Depends on**\n\n${waiting.map(dependencyLine).join('\n')}`]
}

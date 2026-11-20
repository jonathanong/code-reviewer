import type { Dependency } from './dependency.mts'

/** The one line a dependency takes in the posted review, the report and the explanation. */
export const dependencyLine = (entry: Dependency) => `- ${entry.on} (${entry.state}): ${entry.why}`

/** The posted block counts toward the body length target, so it shows few, short lines. */
const POSTED_LINES = 5
const POSTED_WHY_CHARS = 160

const posted = (entry: Dependency) =>
  dependencyLine({ ...entry, why: entry.why.slice(0, POSTED_WHY_CHARS) })

/**
 * The "Depends on" block of the review body: what this change needs first and has not landed.
 * Empty when everything it depends on has merged, so such a body does not change. Past five
 * entries a "+N more" line stands in for the rest; review.json and explain list them all.
 */
export function dependsOnSection(dependencies: readonly Dependency[] | undefined): string[] {
  const waiting = (dependencies ?? []).filter((entry) => entry.state !== 'merged')
  if (waiting.length === 0) return []
  const lines = waiting.slice(0, POSTED_LINES).map(posted)
  const more = waiting.length - lines.length
  if (more > 0) lines.push(`- +${more} more, listed in the full report`)
  return [`**Depends on**\n\n${lines.join('\n')}`]
}

import { sortedReferences } from './codec.ts'
import type { CodecOptions, Reference } from './types.ts'

/**
 * Where an interrupted import resumes: the newest reference in a year that is still open.
 * Undefined when the statement holds none, so the import starts from the top.
 */
export function selectResumePoint(
  lines: readonly string[],
  closedYears: ReadonlySet<number>,
  options: CodecOptions = {},
): Reference | undefined {
  return sortedReferences(lines, options).find((reference) => !closedYears.has(reference.year))
}

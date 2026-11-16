import { formatReference, sortedReferences } from './codec.ts'
import { DEFAULT_PREFIX, type CodecOptions } from './types.ts'

/** The reference to issue next in `year`, continuing after the newest one found in `lines`. */
export function nextReference(
  lines: readonly string[],
  year: number,
  options: CodecOptions = {},
): string {
  const prefix = options.prefix ?? DEFAULT_PREFIX
  const newest = sortedReferences(lines, options).find((reference) => reference.year === year)
  return formatReference({ prefix, year, sequence: (newest?.sequence ?? 0) + 1 })
}

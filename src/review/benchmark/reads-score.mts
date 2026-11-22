import { ReviewError } from '../finding.mts'
import type { Pillar } from '../pillar-name.mts'
import type { EvalCase } from './cases.mts'

/** Parses a case's optional `expectedReads`: a non-empty array of non-empty file paths. */
export function parseExpectedReads(value: unknown, where: string): string[] | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((path) => typeof path !== 'string' || path.length === 0)
  )
    throw new ReviewError(`${where}: expectedReads must be a non-empty array of file paths`)
  return value as string[]
}

export type ReadCase = {
  id: string
  expectedReads: string[]
  /** How many expected reads the run opened; null when the run recorded no reads. */
  opened: number | null
  /** Expected reads the run did not open; empty when `opened` is null. */
  missing: string[]
}

/** The files a case expects one pillar to open: those of its expected pillars; all for a negative. */
export function expectedReadsFor(item: EvalCase, pillar: Pillar): string[] {
  const applies = item.kind === 'negative' || item.expected.some((entry) => entry.pillar === pillar)
  return applies ? (item.expectedReads ?? []) : []
}

/**
 * Counts the expected reads a run opened. Only a Claude run records reads, so a saved result from
 * another harness, or from before reads were recorded, has no count rather than a count of zero.
 */
export function scoreReads(
  item: EvalCase,
  expectedReads: string[],
  saved: { reads?: string[]; harness?: string },
): ReadCase {
  if (saved.reads === undefined || saved.harness !== undefined)
    return { id: item.id, expectedReads, opened: null, missing: [] }
  const missing = expectedReads.filter((path) => !saved.reads?.includes(path))
  return { id: item.id, expectedReads, opened: expectedReads.length - missing.length, missing }
}

/** Markdown lines for the summary: how many expected reads each case opened, and which it did not. */
export function readNotes(entries: readonly { pillar: Pillar; readCases: readonly ReadCase[] }[]) {
  return entries.flatMap(({ pillar, readCases }) =>
    readCases.map((item) => {
      const head = `- ${pillar} ${item.id}:`
      if (item.opened === null)
        return `${head} opened n/a of ${item.expectedReads.length} expected reads (no reads recorded)`
      const left = item.missing.length > 0 ? `; not opened: ${item.missing.join(', ')}` : ''
      return `${head} opened ${item.opened} of ${item.expectedReads.length} expected reads${left}`
    }),
  )
}

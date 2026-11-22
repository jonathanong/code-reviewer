import { BENCH_EFFORTS, type BenchEffort } from '../../harness/types.mts'

/** Checks `bench --effort` before any work; a level outside `BENCH_EFFORTS` (`max`, `ultra`) is refused. */
export function parseBenchEffort(value: string | undefined): BenchEffort | undefined {
  if (value === undefined) return undefined
  const found = BENCH_EFFORTS.find((level) => level === value)
  if (found === undefined)
    throw new Error(
      `bench --effort: unknown level "${value}"; use one of ${BENCH_EFFORTS.join(', ')}.`,
    )
  return found
}

/** The level to record on a row: undefined for the default, so a default row reads as it always did. */
export function otherEffort(level: BenchEffort | null | undefined): BenchEffort | undefined {
  return level === 'medium' ? undefined : (level ?? undefined)
}

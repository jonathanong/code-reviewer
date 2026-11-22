import { BENCH_EFFORTS, type BenchEffort } from '../../harness/types.mts'

/** Checks `bench --effort` before any work; a level outside `BENCH_EFFORTS` (`max`, `ultra`) is refused. */
export function parseBenchEffort(
  value: string | undefined,
  loadsOnly?: boolean,
): BenchEffort | undefined {
  if (value === undefined) return undefined
  if (loadsOnly === true && value !== 'medium')
    throw new Error(
      'bench --effort cannot be used with --loads-only: its report has no effort label.',
    )
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

/**
 * The level to label a pillar with: the flag, else what the saved results record, for
 * `--score-only`. Saved results at different levels are not one arm, so they are refused; a result
 * that records none ran at `medium`.
 */
export function savedEffort(
  flag: BenchEffort | undefined,
  saved: ReadonlyArray<BenchEffort | null>,
): BenchEffort | undefined {
  const given = otherEffort(flag)
  if (given !== undefined) return given
  const levels = new Set(saved.map((level) => level ?? 'medium'))
  if (levels.size > 1)
    throw new Error(
      `bench: the saved results were run at different --effort levels (${[...levels].join(', ')}), so they are not one arm. Score them in separate --out directories.`,
    )
  return otherEffort(saved[0])
}

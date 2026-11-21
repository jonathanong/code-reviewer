import type { ModelStats, RunRecord } from './types.mts'

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length

const share = (records: RunRecord[], pick: (record: RunRecord) => boolean): number | null =>
  mean(records.map((record) => (pick(record) ? 1 : 0)))

const present = (values: (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null)

/**
 * One model's stats. A rate-limited run says nothing about the model, so it is counted in
 * `rateLimited` and left out of every other measure.
 */
export function summarize(id: string, records: RunRecord[]): ModelStats {
  const scored = records.filter((record) => !record.rateLimited)
  const costs = present(records.map((record) => record.costUsd))
  return {
    id,
    runs: records.length,
    valid: share(scored, (record) => record.valid),
    found: share(scored, (record) => record.found),
    extra: mean(scored.filter((record) => record.valid).map((record) => record.extra)),
    seconds: mean(scored.map((record) => record.seconds)),
    tokens: mean(present(scored.map((record) => record.tokens))),
    costUsd: costs.length === 0 ? null : costs.reduce((total, cost) => total + cost, 0),
    rateLimited: records.length - scored.length,
    failures: [...new Set(records.flatMap((record) => record.failure ?? []))],
  }
}

const orElse = (value: number | null, fallback: number) => value ?? fallback

/** Found desc, valid desc, seconds asc; an unscored model last, ties by id. */
export function rank(models: readonly ModelStats[]): ModelStats[] {
  return [...models].sort(
    (a, b) =>
      orElse(b.found, -1) - orElse(a.found, -1) ||
      orElse(b.valid, -1) - orElse(a.valid, -1) ||
      orElse(a.seconds, Infinity) - orElse(b.seconds, Infinity) ||
      a.id.localeCompare(b.id),
  )
}

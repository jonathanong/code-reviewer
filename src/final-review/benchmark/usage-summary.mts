import type { Usage } from './usage.mts'

export type UsageSummary = {
  /** Runs that recorded usage. */
  runs: number
  totalCostUsd: number | null
  meanCostUsd: number | null
  meanTurns: number | null
  /** Mean of input + cache read + cache creation tokens per run. */
  meanInputTokens: number | null
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : sum(values) / values.length
}

function present(values: ReadonlyArray<number | null>): number[] {
  return values.filter((value): value is number => value !== null)
}

/** Totals and means over runs that have usage; runs saved before usage was recorded are skipped. */
export function summarizeUsage(usages: readonly Usage[]): UsageSummary {
  const costs = present(usages.map((usage) => usage.costUsd))
  const input = usages
    .map((usage) => present([usage.inputTokens, usage.cacheReadTokens, usage.cacheCreationTokens]))
    .filter((parts) => parts.length > 0)
    .map(sum)
  return {
    runs: usages.length,
    totalCostUsd: costs.length === 0 ? null : sum(costs),
    meanCostUsd: mean(costs),
    meanTurns: mean(present(usages.map((usage) => usage.turns))),
    meanInputTokens: mean(input),
  }
}

function fixed(value: number | null, digits: number, prefix = ''): string {
  return value === null ? 'n/a' : `${prefix}${value.toFixed(digits)}`
}

/** Renders the cost table that sits under the score table. */
export function renderCostTable(
  summaries: ReadonlyArray<{ pillar: string; usage: UsageSummary }>,
): string {
  const rows = summaries.map(({ pillar, usage }) => {
    const cells = [
      String(usage.runs),
      fixed(usage.totalCostUsd, 2, '$'),
      fixed(usage.meanCostUsd, 2, '$'),
      fixed(usage.meanTurns, 1),
      fixed(usage.meanInputTokens, 0),
    ]
    return `| ${pillar} | ${cells.join(' | ')} |`
  })
  return [
    '| Pillar | Runs with usage | Total cost | Cost per run | Turns per run | Input tokens per run |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

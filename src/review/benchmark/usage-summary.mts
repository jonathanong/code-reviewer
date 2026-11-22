import type { ModelUsage, Usage } from './usage.mts'

/** What one model used across runs: input counts fresh, cache read and cache creation tokens. */
export type ModelTotals = {
  model: string
  /** Runs that used the model. */
  runs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export type UsageSummary = {
  /** Runs that recorded usage. */
  runs: number
  totalCostUsd: number | null
  meanCostUsd: number | null
  meanTurns: number | null
  /** Mean of input + cache read + cache creation tokens per run. */
  meanInputTokens: number | null
  /** Per model, sorted by id. */
  models: ModelTotals[]
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

function modelsOf(usage: Usage): Record<string, ModelUsage> {
  // Results saved before models were recorded have no `byModel`.
  return (usage as { byModel?: Record<string, ModelUsage> }).byModel ?? {}
}

/** Per-model totals over runs; a run counts for each model it used. */
export function summarizeModels(usages: readonly Usage[]): ModelTotals[] {
  const totals = new Map<string, ModelTotals>()
  for (const usage of usages) {
    for (const [model, used] of Object.entries(modelsOf(usage))) {
      const total = totals.get(model) ?? {
        model,
        runs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }
      total.runs += 1
      total.inputTokens += sum(
        present([used.inputTokens, used.cacheReadTokens, used.cacheCreationTokens]),
      )
      total.outputTokens += used.outputTokens ?? 0
      total.costUsd += used.costUsd ?? 0
      totals.set(model, total)
    }
  }
  return [...totals.values()].sort((a, b) => a.model.localeCompare(b.model))
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
    models: summarizeModels(usages),
  }
}

function fixed(value: number | null, digits: number, prefix = ''): string {
  return value === null ? 'n/a' : `${prefix}${value.toFixed(digits)}`
}

/** Renders the cost table that sits under the score table. */
export function renderCostTable(
  summaries: ReadonlyArray<{ pillar: string; usage: UsageSummary; harness?: string }>,
): string {
  const rows = summaries.map(({ pillar, usage, harness }) => {
    // A harness that reports no cost shows a dash, never $0.
    const money = (value: number | null) =>
      value === null && harness !== undefined ? '-' : fixed(value, 2, '$')
    const cells = [
      String(usage.runs),
      money(usage.totalCostUsd),
      money(usage.meanCostUsd),
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

function whole(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/**
 * The "Tokens by model" table: one row per group and model, then an "all" row per model
 * summed over the groups. Groups are pillars, or the verifier and checker runs.
 */
export function renderModelTable(
  groups: ReadonlyArray<{ name: string; models: readonly ModelTotals[] }>,
  heading = 'Pillar',
): string {
  const rows = groups.flatMap(({ name, models }) => models.map((total) => ({ name, total })))
  const all = summarizeTotals(groups.flatMap(({ models }) => models))
  const line = (name: string, total: ModelTotals) =>
    `| ${name} | ${total.model} | ${total.runs} | ${whole(total.inputTokens)} | ${whole(total.outputTokens)} | ${fixed(total.costUsd, 2, '$')} |`
  return [
    `| ${heading} | Model | Runs | Input tokens | Output tokens | Cost |`,
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(({ name, total }) => line(name, total)),
    ...all.map((total) => line('all', total)),
  ].join('\n')
}

/** Adds the same model's totals from several groups. */
export function summarizeTotals(models: readonly ModelTotals[]): ModelTotals[] {
  const merged = new Map<string, ModelTotals>()
  for (const total of models) {
    const into = merged.get(total.model) ?? {
      model: total.model,
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    }
    into.runs += total.runs
    into.inputTokens += total.inputTokens
    into.outputTokens += total.outputTokens
    into.costUsd += total.costUsd
    merged.set(total.model, into)
  }
  return [...merged.values()].sort((a, b) => a.model.localeCompare(b.model))
}

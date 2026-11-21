import type { Usage } from './usage.mts'

/** A token or cost figure over the runs that reported it: the sum, the per-run mean, and how many. */
export type Figure = { total: number; mean: number; runs: number } | null

/** What one model used in one group of runs. A figure is null when no run reported it. */
export type ModelFigures = {
  model: string
  /** Runs that used the model. */
  runs: number
  inputTokens: Figure
  cacheReadTokens: Figure
  cacheCreationTokens: Figure
  outputTokens: Figure
  costUsd: Figure
}

/** Per-model usage of one group (a pillar, the verifier, the checker) in one arm. */
export type ModelReport = {
  group: string
  /** `with skills`, `control`, or null for a step that has no arms. */
  arm: string | null
  /** Runs expected, counting failed and unrecorded ones. */
  runs: number
  /** Runs whose usage lists models; the rest are missing, not zero. Older records have none. */
  covered: number
  models: ModelFigures[]
}

type Field = 'inputTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'outputTokens' | 'costUsd'
const FIELDS: readonly Field[] = [
  'inputTokens',
  'cacheReadTokens',
  'cacheCreationTokens',
  'outputTokens',
  'costUsd',
]

function figure(values: ReadonlyArray<number | null>): Figure {
  const present = values.filter((value): value is number => value !== null)
  if (present.length === 0) return null
  const total = present.reduce((sum, value) => sum + value, 0)
  return { total, mean: total / present.length, runs: present.length }
}

/**
 * Per-model figures over runs. A null entry is a run with no usage (failed, not run); a usage
 * without `byModel` (a record saved before models were kept) is missing too. Neither counts as zero.
 */
export function summarizeByModel(
  group: string,
  arm: string | null,
  usages: ReadonlyArray<Usage | null>,
): ModelReport {
  const perModel = new Map<string, Array<Usage['byModel'][string]>>()
  let covered = 0
  for (const usage of usages) {
    const byModel = (usage as { byModel?: Usage['byModel'] } | null)?.byModel
    if (byModel === undefined || Object.keys(byModel).length === 0) continue
    covered += 1
    for (const [model, used] of Object.entries(byModel)) {
      perModel.set(model, [...(perModel.get(model) ?? []), used])
    }
  }
  const models = [...perModel]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, used]) => ({
      model,
      runs: used.length,
      ...(Object.fromEntries(
        FIELDS.map((field) => [field, figure(used.map((entry) => entry[field]))]),
      ) as Record<Field, Figure>),
    }))
  return { group, arm, runs: usages.length, covered, models }
}

function cell(value: Figure, money = false): string {
  if (value === null) return 'n/a'
  const text = (n: number) => (money ? `$${n.toFixed(2)}` : Math.round(n).toLocaleString('en-US'))
  return `${text(value.total)} / ${text(value.mean)}`
}

const NONE = ['n/a', 'n/a', 'n/a', 'n/a', 'n/a']

/**
 * The "Tokens by model" table. Each figure reads `total / per run`, over the runs that reported
 * it; `Runs` reads `using the model of covered of expected`.
 */
export function renderModelReports(reports: readonly ModelReport[]): string {
  const rows = reports.flatMap((report) => {
    const prefix = `| ${report.group} | ${report.arm ?? '-'} |`
    if (report.models.length === 0)
      return [`${prefix} n/a | 0 of ${report.covered} of ${report.runs} | ${NONE.join(' | ')} |`]
    return report.models.map((m) => {
      const cells = [
        cell(m.inputTokens),
        cell(m.cacheReadTokens),
        cell(m.cacheCreationTokens),
        cell(m.outputTokens),
        cell(m.costUsd, true),
      ]
      return `${prefix} ${m.model} | ${m.runs} of ${report.covered} of ${report.runs} | ${cells.join(' | ')} |`
    })
  })
  return [
    '| Group | Arm | Model | Runs | Input | Cache read | Cache creation | Output | Cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

/** One model's share of a run: the main model and every subagent model are listed separately. */
export type ModelUsage = {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  costUsd: number | null
}

/** Cost and size of one headless run; a field is null when the result event lacks it. */
export type Usage = {
  costUsd: number | null
  turns: number | null
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  /** Per model id, from the result's `modelUsage`; `{}` when absent. Results saved earlier have none. */
  byModel: Record<string, ModelUsage>
}

const plus = (a: number | null, b: number | null) =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0)

/** The usage of two calls counted as one, such as a failed attempt and its retry. */
export function addUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (a === null || b === null) return a ?? b
  const byModel: Record<string, ModelUsage> = { ...a.byModel }
  for (const [model, used] of Object.entries(b.byModel)) {
    const prior = byModel[model]
    byModel[model] =
      prior === undefined
        ? used
        : {
            inputTokens: plus(prior.inputTokens, used.inputTokens),
            outputTokens: plus(prior.outputTokens, used.outputTokens),
            cacheReadTokens: plus(prior.cacheReadTokens, used.cacheReadTokens),
            cacheCreationTokens: plus(prior.cacheCreationTokens, used.cacheCreationTokens),
            costUsd: plus(prior.costUsd, used.costUsd),
          }
  }
  return {
    costUsd: plus(a.costUsd, b.costUsd),
    turns: plus(a.turns, b.turns),
    durationMs: plus(a.durationMs, b.durationMs),
    inputTokens: plus(a.inputTokens, b.inputTokens),
    outputTokens: plus(a.outputTokens, b.outputTokens),
    cacheReadTokens: plus(a.cacheReadTokens, b.cacheReadTokens),
    cacheCreationTokens: plus(a.cacheCreationTokens, b.cacheCreationTokens),
    byModel,
  }
}

import type { Exec } from '../review/benchmark/exec.mts'

/** Free ids whose names do not end in `-free`. */
export const KNOWN_FREE: readonly string[] = ['opencode/big-pickle']

const LIST_TIMEOUT_MS = 60_000

/** One `provider/model` id per line; anything else in the output is ignored. */
export function parseModelList(stdout: string): string[] {
  const ids = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[^\s/]+\/\S+$/u.test(line))
  return [...new Set(ids)]
}

/** A naming heuristic, not a price check: a `-free` suffix on the model part, or a known id. */
export function isFreeModel(id: string): boolean {
  return id.slice(id.indexOf('/') + 1).endsWith('-free') || KNOWN_FREE.includes(id)
}

/** The ids to probe: `explicit` when given, else what `opencode models` lists, filtered by `free`. */
export async function listModels(
  exec: Exec,
  options: { free: boolean; explicit: readonly string[] },
): Promise<string[]> {
  if (options.explicit.length > 0) return [...new Set(options.explicit)]
  const listed = parseModelList(await exec('opencode', ['models'], { timeoutMs: LIST_TIMEOUT_MS }))
  return options.free ? listed.filter(isFreeModel) : listed
}

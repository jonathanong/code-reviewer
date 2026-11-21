/** Free ids whose names do not end in `-free`. */
export const KNOWN_FREE: readonly string[] = ['opencode/big-pickle']

/** A naming heuristic, not a price check: a `-free` suffix on the model part, or a known id. */
export function isFreeModel(id: string): boolean {
  return id.slice(id.indexOf('/') + 1).endsWith('-free') || KNOWN_FREE.includes(id)
}

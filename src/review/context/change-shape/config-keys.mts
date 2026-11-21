/** A config file larger than this (characters) is listed without its keys. */
export const CONFIG_KEYS_MAX_CHARS = 20_000
/** Changed keys listed per file. */
export const CONFIG_KEYS_MAX = 15

const MAX_DEPTH = 3

function flatten(value: unknown, prefix: string, out: Map<string, string>, depth: number): void {
  if (depth < MAX_DEPTH && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix === '' ? key : `${prefix}.${key}`, out, depth + 1)
    }
    return
  }
  out.set(prefix, JSON.stringify(value))
}

function parse(text: string | null): Map<string, string> | null {
  const out = new Map<string, string>()
  if (text === null) return out
  try {
    flatten(JSON.parse(text), '', out, 0)
  } catch {
    return null
  }
  return out
}

/**
 * The dotted keys (three levels deep) whose value differs between two JSON texts; a `null` text is
 * an absent file. Returns `null` when either text is not plain JSON, so a file with comments is
 * listed without keys instead of with wrong ones.
 */
export function changedKeys(before: string | null, after: string | null): string[] | null {
  const a = parse(before)
  const b = parse(after)
  if (a === null || b === null) return null
  const keys = new Set([...a.keys(), ...b.keys()])
  return [...keys].filter((key) => a.get(key) !== b.get(key)).sort()
}

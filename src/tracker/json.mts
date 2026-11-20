export type Json = Record<string, unknown>

export function asRecord(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
}

export const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

export const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** A JSON file as an object; a missing or malformed file is an empty one. */
export function readJson(read: (path: string) => string | undefined, path: string): Json {
  try {
    const text = read(path)
    return text === undefined ? {} : asRecord(JSON.parse(text))
  } catch {
    return {}
  }
}

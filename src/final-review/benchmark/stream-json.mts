/** Parses the JSON documents in `claude -p` output: JSONL for stream-json, one object for json. */
export function jsonLines(stdout: string): unknown[] {
  const docs: unknown[] = []
  for (const line of stdout.split('\n')) {
    try {
      docs.push(JSON.parse(line))
    } catch {
      // Blank and non-JSON lines are ignored.
    }
  }
  return docs
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** The object events in `claude -p` output. */
export function jsonEvents(stdout: string): Record<string, unknown>[] {
  return jsonLines(stdout).filter(isObject)
}

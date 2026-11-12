import { readFileSync } from 'node:fs'

/** Loads the calling app's flags.json; keys not declared there are never served. */
export default function declared(path = 'flags.json'): ReadonlyMap<string, boolean> {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, boolean>
  return new Map(Object.entries(raw))
}

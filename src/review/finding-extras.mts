import { DEPENDENCY_KINDS, DEPENDENCY_STATES, type Dependency } from './dependency.mts'
import { isRecord, oneOf, ReviewError, text } from './finding.mts'

const MAX_NOTES = 10
const MAX_NOTE_CHARS = 600

/** The informational notes of a `review.json`: bounded, trimmed, never empty strings. */
export function parseNotes(raw: unknown): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new ReviewError('notes must be an array.')
  return raw.slice(0, MAX_NOTES).map((entry: unknown, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new ReviewError(`notes[${index}] must be a non-empty string.`)
    }
    return entry.trim().slice(0, MAX_NOTE_CHARS)
  })
}

export function parseDependency(raw: unknown, index: number): Dependency {
  const where = `dependencies[${index}]`
  if (!isRecord(raw)) throw new ReviewError(`${where} must be an object.`)
  return {
    on: text(raw, 'on', where).trim(),
    kind: oneOf(DEPENDENCY_KINDS, raw.kind, `${where}.kind`),
    state: oneOf(DEPENDENCY_STATES, raw.state, `${where}.state`),
    why: text(raw, 'why', where).trim(),
  }
}

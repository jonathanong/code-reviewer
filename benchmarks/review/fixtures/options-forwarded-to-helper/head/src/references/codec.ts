import { DEFAULT_PREFIX, type CodecOptions, type Reference } from './types.ts'

/** Parses `inv-2026-000123`; undefined when the text is not one of this deployment's references. */
export function parseReference(text: string, options: CodecOptions = {}): Reference | undefined {
  const prefix = options.prefix ?? DEFAULT_PREFIX
  const match = /^([a-z]+)-(\d{4})-(\d{6})$/u.exec(text)
  if (match === null || match[1] !== prefix) return undefined
  return { prefix, year: Number(match[2]), sequence: Number(match[3]) }
}

export function formatReference(reference: Reference): string {
  return `${reference.prefix}-${reference.year}-${String(reference.sequence).padStart(6, '0')}`
}

/** Every reference in `lines`, newest first; lines that are not ours are dropped. */
export function sortedReferences(
  lines: readonly string[],
  options: CodecOptions = {},
): Reference[] {
  const found: Reference[] = []
  for (const line of lines) {
    const reference = parseReference(line.trim(), options)
    if (reference !== undefined) found.push(reference)
  }
  return found.sort((a, b) => b.year - a.year || b.sequence - a.sequence)
}

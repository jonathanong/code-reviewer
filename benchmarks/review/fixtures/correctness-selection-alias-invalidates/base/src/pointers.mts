/** The JSON pointers whose value differs between two parsed documents. */
export function changedPointers(before: unknown, after: unknown, at = ''): string[] {
  const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
  if (!object(before) || !object(after)) {
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [at]
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].flatMap((key) => changedPointers(before[key], after[key], `${at}/${key}`))
}

/** True when one pointer is the other or a prefix of it. */
export function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

import declared from './declared.ts'

/** Returns whether `key` is on. Unknown keys are off; see AGENTS.md for the caller rules. */
export function isEnabled(key: string, served: ReadonlyMap<string, boolean> = declared()): boolean {
  return served.get(key) ?? false
}

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Stack, StackMember } from './stack.mts'

/** A stack member as `stack.json` records it; later members carry the path of their diff. */
export type StackFileMember = StackMember & {
  /** Path of the index of the member's changed files, relative to the run directory; its numbered patches, one per file, sit beside it. */
  diff?: string
  /** Why the diff was not written. */
  diffSkipped?: string
}

/** `stack.json`, written by `prepare` only when the pull request is in a stack. */
export type StackFile = Omit<Stack, 'members'> & { members: StackFileMember[] }

/** Reads `stack.json` from a run directory; undefined for a flat pull request. */
export function readStackFile(out: string): StackFile | undefined {
  const path = join(out, 'stack.json')
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as StackFile) : undefined
}

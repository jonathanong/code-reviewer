import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { diffFileName, renderDiffIndex, splitDiff } from '../diff-files.mts'
import { numberDiff } from '../numbered-diff.mts'

export type Snapshot = {
  /** Git-free tree of the pull request head; the reviewer's working directory. */
  dir: string
  diff: string
  body: string
}

/** Context files a pillar reads, kept inside the snapshot so read-only tools can reach them. */
export const CONTEXT_DIR = '.final-review'

/** Writes the diff, per-file patches, index, and description the reviewer reads. */
export function writeContext(dir: string, title: string, diff: string, body: string): void {
  const context = join(dir, CONTEXT_DIR)
  mkdirSync(context, { recursive: true })
  const numbered = numberDiff(diff)
  writeFileSync(join(context, 'diff.patch'), numbered)
  // Per-file patches and an index let a reviewer of a large diff read one file at a time.
  const files = splitDiff(numbered)
  mkdirSync(join(context, 'diff'), { recursive: true })
  files.forEach((file, index) => {
    writeFileSync(join(context, 'diff', diffFileName(index)), file.text)
  })
  writeFileSync(join(context, 'files.md'), renderDiffIndex(files, `${CONTEXT_DIR}/diff`))
  writeFileSync(join(context, 'pr.md'), `# ${title}\n\n${body.trim()}\n`)
}

/** True when the snapshot carries reviewer comments in `.final-review/context.md`. */
export function hasContextNotes(dir: string): boolean {
  return existsSync(join(dir, CONTEXT_DIR, 'context.md'))
}

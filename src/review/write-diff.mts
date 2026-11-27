import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { numberDiff } from './numbered-diff.mts'
import { diffFileName, renderIndexFile, splitDiff } from './diff-files.mts'

export type Write = (path: string, text: string) => void

/** Writes an already numbered diff into `dir` as one patch per file plus `INDEX.md`. */
export function writeDiffDir(dir: string, numbered: string, write: Write): void {
  mkdirSync(dir, { recursive: true })
  const files = splitDiff(numbered)
  files.forEach((file, index) => write(join(dir, diffFileName(index)), file.text))
  write(join(dir, 'INDEX.md'), renderIndexFile(files, dir))
}

/** Writes `name.patch` and `name/` for a diff, numbering it first; returns the file names relative to the run directory. */
export function writeDiff(out: string, name: string, patch: string, write: Write): string[] {
  const numbered = numberDiff(patch)
  write(join(out, `${name}.patch`), numbered)
  writeDiffDir(join(out, name), numbered, write)
  return [`${name}.patch`, `${name}/INDEX.md`]
}

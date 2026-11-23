import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ExecError, type Exec } from './exec.mts'

import { diffFileName, renderDiffIndex, splitDiff } from '../diff-files.mts'
import { numberDiff } from '../numbered-diff.mts'
import { findRelatedDocs, RELATED_DOCS_FILE, renderRelatedDocs } from '../related-docs.mts'

export type Snapshot = {
  /** Git-free tree of the pull request head; the reviewer's working directory. */
  dir: string
  diff: string
  body: string
}

/** Context files a pillar reads, kept inside the snapshot so read-only tools can reach them. */
export const CONTEXT_DIR = '.review'

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

/** True when the snapshot carries reviewer comments in `.review/context.md`. */
export function hasContextNotes(dir: string): boolean {
  return existsSync(join(dir, CONTEXT_DIR, 'context.md'))
}

/** True when `.review/rules/INDEX.md` lists rule sources for this snapshot. */
export function hasRulesIndex(dir: string): boolean {
  return existsSync(join(dir, CONTEXT_DIR, 'rules', 'INDEX.md'))
}

/** The snapshot's list of document lines that mention what changed, when the search found any. */
export function relatedDocs(dir: string): string | undefined {
  const path = join(dir, CONTEXT_DIR, RELATED_DOCS_FILE)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/**
 * Stages the document lines that mention what the diff changed, searched in the snapshot tree.
 * `git grep` exits 1 when nothing matches.
 */
export async function writeRelatedDocs(dir: string, diff: string, exec: Exec): Promise<void> {
  const paths = splitDiff(diff).map((file) => file.path)
  const docs = renderRelatedDocs(
    await findRelatedDocs(paths, async (args) => {
      try {
        return await exec('git', ['-C', dir, ...args, `:(exclude)${CONTEXT_DIR}`])
      } catch (error) {
        if (error instanceof ExecError && error.code === 1) return ''
        throw error
      }
    }),
  )
  if (docs !== undefined) writeFileSync(join(dir, CONTEXT_DIR, RELATED_DOCS_FILE), docs)
}

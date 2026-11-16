import { join } from 'node:path'

import { diffExcerpt, renderIndexFile, splitDiff } from '../diff-files.mts'
import { numberDiff } from '../numbered-diff.mts'
import { CONTEXT_DIR, type Snapshot } from './snapshot-context.mts'

/** What `review` hands the selection call: the title and the numbered changed-file index. */
export type SelectionText = { title: string; index: string; excerpt: string }

/**
 * Rebuilds the selection input from a snapshot the way `prepare` writes it for a review: the
 * title is the first line of the snapshot's `pr.md`, and the index is `diff/INDEX.md` with the
 * numbered-diff legend, pointing at the snapshot's per-file patches.
 */
export function selectionText(
  snapshot: Snapshot,
  readFile: (path: string) => string,
): SelectionText {
  const context = join(snapshot.dir, CONTEXT_DIR)
  const [first = ''] = readFile(join(context, 'pr.md')).split('\n')
  const files = splitDiff(numberDiff(snapshot.diff))
  return {
    title: first.replace(/^#\s*/u, '') || '(untitled)',
    index: renderIndexFile(files, join(context, 'diff')),
    excerpt: diffExcerpt(files),
  }
}

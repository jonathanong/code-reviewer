import { isAbsolute, join, relative, resolve } from 'node:path'

import type { PrepareIo } from './prepare-io.mts'
import { findRelatedDocs, RELATED_DOCS_FILE, renderRelatedDocs } from './related-docs.mts'
import type { Write } from './write-diff.mts'

/** The run directory as a pathspec that leaves it out, when it lies inside the tree. */
function excludeRunDir(tree: string, out: string): string[] {
  const inside = relative(resolve(tree), resolve(out))
  return inside === '' || inside.startsWith('..') || isAbsolute(inside)
    ? []
    : [`:(exclude)${inside}`]
}

/**
 * The lines of the checkout's Markdown files that mention the names of the changed files, written
 * to `docs.md` when there are any, for the verifier to compare with the patches. With no checkout
 * there is nothing to search. A search that fails records a problem and the review goes on.
 */
export async function prepareDocs(
  io: PrepareIo,
  out: string,
  write: Write,
  tree: string | undefined,
  paths: readonly string[],
): Promise<{ written: string[]; problems: string[] }> {
  if (tree === undefined) return { written: [], problems: [] }
  const skip = excludeRunDir(tree, out)
  try {
    const found = await findRelatedDocs(paths, (args) => io.docGrep(tree, [...args, ...skip]))
    const docs = renderRelatedDocs(found)
    if (docs === undefined) return { written: [], problems: [] }
    write(join(out, RELATED_DOCS_FILE), docs)
    return { written: [RELATED_DOCS_FILE], problems: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { written: [], problems: [`The search of the documentation failed: ${reason}`] }
  }
}

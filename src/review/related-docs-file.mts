import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { RELATED_DOCS_FILE } from './related-docs.mts'

export function clearDocs(out: string): void {
  rmSync(join(out, RELATED_DOCS_FILE), { force: true })
}

/** The document lines `prepare` found that mention what changed; absent when it found none. */
export function readDocs(out: string): string | undefined {
  const path = join(out, RELATED_DOCS_FILE)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

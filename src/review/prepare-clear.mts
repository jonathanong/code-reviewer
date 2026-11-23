import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { clearCarried } from './carried-file.mts'
import { clearEarlier } from './earlier-file.mts'
import { clearDependencies } from './dependency.mts'
import { clearIssues } from './issues.mts'
import { clearDocs } from './related-docs-file.mts'
import { clearPush } from './push-file.mts'

/** Removes what an earlier `prepare` left in `out`: a rerun must not keep a stale stack, push, or link. */
export function clearPrepared(out: string): void {
  rmSync(join(out, 'stack.json'), { force: true })
  rmSync(join(out, 'stack'), { recursive: true, force: true })
  clearPush(out)
  clearEarlier(out)
  clearCarried(out)
  clearDependencies(out)
  clearIssues(out)
  clearDocs(out)
}

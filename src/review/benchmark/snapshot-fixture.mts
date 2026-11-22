import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { FixtureCase } from './cases.mts'
import { ExecError, type Exec } from './exec.mts'
import { onlyPathDiff } from './only-path.mts'
import { CONTEXT_DIR, writeContext, type Snapshot } from './snapshot-context.mts'

/**
 * Drops the `base/` and `head/` tree names from a `git diff --no-index` so paths read `a/x` `b/x`.
 * Git prints `a/head/x` for an addition and `b/base/x` for a deletion, and quotes a path with
 * non-ASCII bytes (`"a/head/caf\303\251"`), so either side prefix is rewritten after a space or quote.
 */
export function normalizeFixtureDiff(diff: string): string {
  return diff
    .split('\n')
    .map((line) =>
      /^(diff --git |--- |\+\+\+ )/u.test(line)
        ? line.replace(/(^|[\s"])([ab])\/(?:base|head)\//gu, '$1$2/')
        : line,
    )
    .join('\n')
}

/** Builds a snapshot from a fixture directory: `head/` is the tree, `base/` only feeds the diff. */
export async function prepareFixtureSnapshot(
  item: FixtureCase,
  workRoot: string,
  exec: Exec,
  onlyPath?: readonly string[],
): Promise<Snapshot> {
  const caseRoot = join(workRoot, item.id)
  const dir = join(caseRoot, 'tree')
  rmSync(caseRoot, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  cpSync(join(item.fixtureDir, 'head'), dir, { recursive: true })
  let raw: string
  try {
    raw = await exec('git', ['diff', '--no-index', '--no-color', 'base', 'head'], {
      cwd: item.fixtureDir,
    })
  } catch (error) {
    // `--no-index` exits 1 when the trees differ; the diff is on stdout.
    if (!(error instanceof ExecError) || error.code !== 1) throw error
    raw = error.stdout
  }
  const diff = onlyPathDiff(item.id, normalizeFixtureDiff(raw), onlyPath)
  const pr = readFileSync(join(item.fixtureDir, 'pr.md'), 'utf8')
  const [titleLine = '', ...rest] = pr.split('\n')
  const body = rest.join('\n')
  writeContext(dir, titleLine.replace(/^#\s*/u, '') || item.title, diff, body)
  const notes = join(item.fixtureDir, 'context.md')
  if (existsSync(notes)) cpSync(notes, join(dir, CONTEXT_DIR, 'context.md'))
  return { dir, diff, body }
}

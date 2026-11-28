import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { FixtureCase } from './cases.mts'
import { ExecError, type Exec } from './exec.mts'
import { onlyPathDiff } from './only-path.mts'
import { writeDiff } from '../write-diff.mts'
import { followUpContextText } from './followup-prompt.mts'
import { CONTEXT_DIR, writeContext, writeRelatedDocs, type Snapshot } from './snapshot-context.mts'

/**
 * Drops the `base/`, `reviewed/` and `head/` tree names from a `git diff --no-index` so paths read `a/x` `b/x`.
 * Git prints `a/head/x` for an addition and `b/base/x` for a deletion, and quotes a path with
 * non-ASCII bytes (`"a/head/caf\303\251"`), so either side prefix is rewritten after a space or quote.
 */
export function normalizeFixtureDiff(diff: string): string {
  return diff
    .split('\n')
    .map((line) =>
      /^(diff --git |--- |\+\+\+ )/u.test(line)
        ? line.replace(/(^|[\s"])([ab])\/(?:base|head|reviewed)\//gu, '$1$2/')
        : line,
    )
    .join('\n')
}

/** `git diff --no-index` of two trees in a fixture directory. */
async function diffTrees(root: string, from: string, exec: Exec): Promise<string> {
  try {
    return await exec('git', ['diff', '--no-index', '--no-color', from, 'head'], { cwd: root })
  } catch (error) {
    // `--no-index` exits 1 when the trees differ; the diff is on stdout.
    if (!(error instanceof ExecError) || error.code !== 1) throw error
    return error.stdout
  }
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
  const raw = await diffTrees(item.fixtureDir, 'base', exec)
  const diff = onlyPathDiff(item.id, normalizeFixtureDiff(raw), onlyPath)
  const pr = readFileSync(join(item.fixtureDir, 'pr.md'), 'utf8')
  const [titleLine = '', ...rest] = pr.split('\n')
  const body = rest.join('\n')
  const title = titleLine.replace(/^#\s*/u, '') || item.title
  writeContext(dir, title, diff, body)
  await writeRelatedDocs(dir, diff, exec)
  const notes = join(item.fixtureDir, 'context.md')
  if (existsSync(notes)) cpSync(notes, join(dir, CONTEXT_DIR, 'context.md'))
  if (item.followUp !== undefined) {
    // The reviewed tree is what the earlier review saw: its diff to the head is the since-diff.
    const since = normalizeFixtureDiff(await diffTrees(item.fixtureDir, 'reviewed', exec))
    writeDiff(join(dir, CONTEXT_DIR), 'since', since, (path, text) => writeFileSync(path, text))
    writeFileSync(
      join(dir, CONTEXT_DIR, 'context.md'),
      followUpContextText(item.followUp, title, body),
    )
  }
  return { dir, diff, body }
}

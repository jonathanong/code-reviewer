import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { numberDiff } from '../numbered-diff.mts'
import { writeDiffDir } from '../write-diff.mts'
import { isFixtureCase, type EvalCase } from './cases.mts'
import type { Exec } from './exec.mts'
import type { stageCaseRules } from './rules.mts'
import { cacheDirOf, fetchShas } from './snapshot-cache.mts'
import { CONTEXT_DIR, type Snapshot } from './snapshot.mts'

const GIT_IDENTITY = [
  '-c',
  'user.name=bench',
  '-c',
  'user.email=bench@example.test',
  '-c',
  'commit.gpgsign=false',
]

/** Inputs `runFocus` needs for one benchmark case, built from its snapshot. */
export type PreparedFocusCase = {
  tree: string
  out: string
  baseSha: string
  headSha: string
  hasRules: boolean
}

export type PrepareFocusDeps = {
  exec: Exec
  prepare(item: EvalCase, cache: string, work: string, exec: Exec): Promise<Snapshot>
  stageRules: typeof stageCaseRules
}

async function git(exec: Exec, cwd: string, args: string[]): Promise<string> {
  return exec('git', [...GIT_IDENTITY, ...args], { cwd })
}

/** Builds a two-commit git checkout (`base/` then `head/`) so `buildFocusFacts` can run real git commands. */
async function buildFixtureGitTree(
  fixtureDir: string,
  tree: string,
  exec: Exec,
): Promise<{ baseSha: string; headSha: string }> {
  rmSync(tree, { recursive: true, force: true })
  mkdirSync(tree, { recursive: true })
  cpSync(join(fixtureDir, 'base'), tree, { recursive: true })
  await git(exec, tree, ['init', '-q', '-b', 'main'])
  await git(exec, tree, ['add', '-A'])
  await git(exec, tree, ['commit', '-q', '--allow-empty', '-m', 'base'])
  const baseSha = (await git(exec, tree, ['rev-parse', 'HEAD'])).trim()
  for (const entry of readdirSync(tree)) {
    if (entry !== '.git') rmSync(join(tree, entry), { recursive: true, force: true })
  }
  cpSync(join(fixtureDir, 'head'), tree, { recursive: true })
  await git(exec, tree, ['add', '-A'])
  await git(exec, tree, ['commit', '-q', '--allow-empty', '-m', 'head'])
  const headSha = (await git(exec, tree, ['rev-parse', 'HEAD'])).trim()
  return { baseSha, headSha }
}

/**
 * Prepares a case's git checkout and review-shaped run directory (`context.json`, `context.md`,
 * `diff/INDEX.md`, optional `rules/INDEX.md`) so the real `runFocus` and `buildFocusFacts` run
 * identically to a review.
 */
export async function prepareFocusCase(
  item: EvalCase,
  options: { cache: string; work: string; noRules: boolean },
  deps: PrepareFocusDeps,
): Promise<PreparedFocusCase> {
  const snapshot = await deps.prepare(item, options.cache, options.work, deps.exec)
  if (!isFixtureCase(item) && item.focusRefs !== undefined) {
    // The checkout reads the cache's objects through `alternates`, so a pinned head fetched here is
    // reachable from it and `runFocus` needs no network and no remote.
    const pinned = Object.values(item.focusRefs)
    await fetchShas(cacheDirOf(options.cache, item.repo), pinned, deps.exec)
  }
  const { tree, baseSha, headSha } = isFixtureCase(item)
    ? {
        tree: join(options.work, item.id, 'git-tree'),
        ...(await buildFixtureGitTree(
          item.fixtureDir,
          join(options.work, item.id, 'git-tree'),
          deps.exec,
        )),
      }
    : { tree: snapshot.dir, baseSha: item.baseSha, headSha: item.headSha }
  const out = join(options.work, item.id, 'run')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  writeFileSync(
    join(out, 'context.json'),
    `${JSON.stringify({ title: item.title, intent: { body: snapshot.body } }, null, 2)}\n`,
  )
  writeFileSync(join(out, 'context.md'), `# ${item.title}\n\n${snapshot.body.trim()}\n`)
  writeDiffDir(join(out, 'diff'), numberDiff(snapshot.diff), (path, text) =>
    writeFileSync(path, text),
  )
  let hasRules = false
  if (!options.noRules) {
    await deps.stageRules(item, snapshot)
    const staged = join(snapshot.dir, CONTEXT_DIR, 'rules')
    if (existsSync(staged)) {
      cpSync(staged, join(out, 'rules'), { recursive: true })
      hasRules = existsSync(join(out, 'rules', 'INDEX.md'))
    }
  }
  return { tree, out, baseSha, headSha, hasRules }
}

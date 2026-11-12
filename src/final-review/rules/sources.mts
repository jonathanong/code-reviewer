import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { RunTextCommand } from '../../gh-cli/index.mts'
import { defaultRef, gitReader } from './reader.mts'
import { SHARED_SOURCES } from './shared.mts'
import type { StageInput } from './stage.mts'

export type Sources = Pick<StageInput, 'repo' | 'shared' | 'related' | 'missing'>

const NO_CLONES = 'no clone root (pass --clones or set FINAL_REVIEWER_CLONE_ROOT)'

/** Shared sources whose clones exist under `clones`, read at their default branch. */
export async function sharedFromClones(
  clones: string | undefined,
  git: RunTextCommand,
): Promise<Pick<Sources, 'shared' | 'missing'>> {
  const shared: Sources['shared'] = []
  const missing: string[] = []
  for (const source of SHARED_SOURCES) {
    if (clones === undefined) {
      missing.push(`${source.name}: ${NO_CLONES}`)
      continue
    }
    const dir = join(clones, source.cloneDir)
    if (!existsSync(join(dir, '.git'))) {
      missing.push(`${source.name}: no clone at ${dir}`)
      continue
    }
    const ref = await defaultRef(dir, git)
    shared.push({ source, reader: gitReader(dir, ref, git), refLabel: `default branch ${ref}` })
  }
  return { shared, missing }
}

/** Every clone under `clones` except the pull request's own, as dependency candidates. */
export async function cloneCandidates(
  clones: string,
  git: RunTextCommand,
  exclude: string,
): Promise<Sources['related']> {
  const entries = (() => {
    try {
      return readdirSync(clones, { withFileTypes: true })
    } catch {
      return []
    }
  })()
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name !== exclude)
    .filter((entry) => existsSync(join(clones, entry.name, '.git')))
    .map((entry) => entry.name)
    .sort()
  const candidates: Sources['related'] = []
  for (const name of names) {
    const dir = join(clones, name)
    const ref = await defaultRef(dir, git)
    candidates.push({
      name,
      reader: gitReader(dir, ref, git),
      refLabel: `default branch ${ref}`,
      codeHint: `clone ${dir}; read code with git -C ${dir} show ${ref}:<path> (the working tree may be on another branch)`,
      stageCode: false,
    })
  }
  return candidates
}

/** Rule sources for `prepare`: the base of the PR repo when a tree is given, plus the clones. */
export async function productionSources(args: {
  git: RunTextCommand
  clones: string | undefined
  tree: string | undefined
  baseSha: string
  repoName: string
}): Promise<Sources> {
  const { git, clones, tree, baseSha, repoName } = args
  const { shared, missing } = await sharedFromClones(clones, git)
  const related = clones === undefined ? [] : await cloneCandidates(clones, git, repoName)
  if (clones === undefined) missing.push(`dependencies: skipped (${NO_CLONES})`)
  const repo =
    tree === undefined
      ? {}
      : {
          repo: {
            reader: gitReader(tree, baseSha, git),
            refLabel: `base ${baseSha.slice(0, 7)}`,
          },
        }
  return { ...repo, shared, related, missing }
}

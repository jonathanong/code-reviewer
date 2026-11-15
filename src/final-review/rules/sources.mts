import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { splitRepo, type RunTextCommand } from '../../gh-cli/index.mts'
import { loadRepoConfigs } from './config.mts'
import { defaultRef, gitReader } from './reader.mts'
import { SHARED_SOURCES } from './shared.mts'
import type { StageInput } from './stage.mts'

export type Sources = Pick<
  StageInput,
  'repo' | 'repoId' | 'configs' | 'shared' | 'related' | 'missing'
>

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

/** `owner/name` from a clone's origin URL (https or ssh), or undefined without a usable origin. */
export async function originRepo(dir: string, git: RunTextCommand): Promise<string | undefined> {
  try {
    const url = (await git(['-C', dir, 'remote', 'get-url', 'origin'])).trim()
    const match = /[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/u.exec(url)
    return match === null ? undefined : `${match[1]}/${match[2]}`
  } catch {
    return undefined
  }
}

/** Every clone under `clones` except the pull request's own, as candidate linked repositories. */
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
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(clones, entry.name, '.git')))
    .map((entry) => entry.name)
    .sort()
  const self = exclude.toLowerCase()
  const candidates: Sources['related'] = []
  for (const name of names) {
    const dir = join(clones, name)
    const repo = await originRepo(dir, git)
    // The pull request's own clone: by origin when known, else by directory name.
    if ((repo ?? `${splitRepo(self).owner}/${name}`).toLowerCase() === self) continue
    const ref = await defaultRef(dir, git)
    candidates.push({
      name,
      ...(repo === undefined ? {} : { repo }),
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
  /** The reviewed repository as `owner/name`. */
  repoId: string
  /** The directory of per-repository configs. */
  configDir: string
}): Promise<Sources> {
  const { git, clones, tree, baseSha, repoId } = args
  const configs = loadRepoConfigs(args.configDir)
  const { shared, missing } = await sharedFromClones(clones, git)
  missing.push(...configs.problems)
  const related = clones === undefined ? [] : await cloneCandidates(clones, git, repoId)
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
  return { ...repo, repoId, configs, shared, related, missing }
}

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { splitRepo, type RunTextCommand } from '../../gh-cli/index.mts'
import { loadRepoConfigs } from './config.mts'
import { defaultRef, gitReader } from './reader.mts'
import { readTargetConfig, withTargetConsumes, type TargetFileReader } from './target-config.mts'
import type { StageInput } from './stage.mts'

export type Sources = Pick<StageInput, 'repo' | 'repoId' | 'configs' | 'related' | 'missing'>

const NO_CLONES = 'no clone root (pass --clones or set CODE_REVIEWER_CLONE_ROOT)'

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

/** Rule sources for `prepare`: the base of the PR repo when a tree is given, plus the dependency clones. */
export async function productionSources(args: {
  git: RunTextCommand
  clones: string | undefined
  tree: string | undefined
  baseSha: string
  /** The reviewed repository as `owner/name`. */
  repoId: string
  /** The machine config directory. */
  configDir: string
  /** Reads the reviewed repository's `.code-reviewer` config file (any accepted ending) from its default branch. */
  targetFile: TargetFileReader
}): Promise<Sources> {
  const { git, clones, tree, baseSha, repoId } = args
  const machine = loadRepoConfigs(args.configDir)
  const target = await readTargetConfig(args.targetFile, repoId)
  const configs = withTargetConsumes(machine, repoId, target.config)
  const related = clones === undefined ? [] : await cloneCandidates(clones, git, repoId)
  const missing = [
    ...machine.problems,
    ...target.problems,
    ...(clones === undefined ? [`dependencies: skipped (${NO_CLONES})`] : []),
  ]
  const repo =
    tree === undefined
      ? {}
      : {
          repo: {
            reader: gitReader(tree, baseSha, git),
            refLabel: `base ${baseSha.slice(0, 7)}`,
          },
        }
  return { ...repo, repoId, configs, related, missing }
}

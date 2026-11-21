import type { RunTextCommand } from '../../gh-cli/index.mts'
import { CONFIG_EXTENSIONS, TARGET_CONFIG_NAMES, conflictProblem } from './config-files.mts'
import { parseRepoConfig, type RepoConfig, type RepoConfigs } from './config.mts'
import { defaultRef, gitReader } from './reader.mts'

export type TargetConfig = {
  /** Undefined when the repository has no file, has several, or it could not be read. */
  config: RepoConfig | undefined
  problems: string[]
}

/** One of the config files a reviewed repository keeps at its root, as it is on the default branch. */
export type TargetFile = { name: string; text: string }

/** Resolves every config file the repository keeps (none for no file); rejects on any other failure. */
export type TargetFileReader = () => Promise<TargetFile[]>

const ABSENT = /\b404\b|not found/iu

/**
 * Reads the files from the default branch through the GitHub contents API: one listing of the
 * repository root, then one request per file found. A repository with no file costs one request
 * however many names are accepted, and a second file is seen without trying each name.
 */
export function apiFileReader(run: RunTextCommand, repo: string): TargetFileReader {
  return async () => {
    try {
      const listing = await run([
        'api',
        '--jq',
        '.[] | select(.type == "file") | .name',
        `repos/${repo}/contents`,
      ])
      const present = new Set(listing.split('\n').map((name) => name.trim()))
      return await Promise.all(
        TARGET_CONFIG_NAMES.filter((name) => present.has(name)).map(async (name) => ({
          name,
          text: await run([
            'api',
            '-H',
            'Accept: application/vnd.github.raw+json',
            `repos/${repo}/contents/${name}`,
          ]),
        })),
      )
    } catch (error) {
      if (error instanceof Error && ABSENT.test(error.message)) return []
      throw error
    }
  }
}

/**
 * Reads the files from a clone's remote default branch, never its working tree or checked-out
 * head. A clone with no remote default branch falls back to `fallback`, because its `HEAD` may be
 * the pull request.
 */
export function gitFileReader(
  tree: string,
  git: RunTextCommand,
  fallback: TargetFileReader,
): TargetFileReader {
  return async () => {
    const ref = await defaultRef(tree, git)
    if (ref === 'HEAD') return fallback()
    const reader = gitReader(tree, ref, git)
    const found = await Promise.all(
      TARGET_CONFIG_NAMES.map(async (name) => ({ name, text: await reader.read(name) })),
    )
    return found.filter((file): file is TargetFile => file.text !== undefined)
  }
}

/** Parses the repository's file (`trusted` when the machine config sets `trustRepoConfig` for it); a failed read or a bad file is a problem, never an error. */
export async function readTargetConfig(
  read: TargetFileReader,
  repo: string,
  trusted = false,
): Promise<TargetConfig> {
  try {
    const files = await read()
    const [file] = files
    if (file === undefined) return { config: undefined, problems: [] }
    if (files.length > 1) {
      const names = files.map((found) => `${repo}/${found.name}`)
      return { config: undefined, problems: [conflictProblem(names)] }
    }
    const config = parseRepoConfig(
      file.text,
      `${repo}/${file.name}`,
      trusted ? 'trusted' : 'target',
    )
    return { config, problems: config.problems }
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).split('\n')[0]
    const where = `${repo}/.code-reviewer{${CONFIG_EXTENSIONS.join(',')}}`
    return { config: undefined, problems: [`${where}: could not be read (${reason}); ignored`] }
  }
}

/** Adds the repository file's `consumes` to `configs` unless the machine config sets its own. */
export function withTargetConsumes(
  configs: RepoConfigs,
  repoId: string,
  target: RepoConfig | undefined,
): RepoConfigs {
  if (target === undefined) return configs
  const key = repoId.toLowerCase()
  const machine = configs.byRepo.get(key)
  if (machine !== undefined && machine.consumes.length > 0) return configs
  const byRepo = new Map(configs.byRepo)
  byRepo.set(key, { ...(machine ?? { problems: [] }), consumes: target.consumes })
  return { ...configs, byRepo }
}

import type { RunTextCommand } from '../../gh-cli/index.mts'
import { parseRepoConfig, type RepoConfig, type RepoConfigs } from './config.mts'
import { defaultRef, gitReader } from './reader.mts'

/** The file a reviewed repository may keep at its root, read from its default branch. */
export const TARGET_CONFIG_FILE = '.code-reviewer.json'

export type TargetConfig = {
  /** Undefined when the repository has no file or it could not be read. */
  config: RepoConfig | undefined
  problems: string[]
}

/** Resolves the file's text, undefined when the repository has none; rejects on any other failure. */
export type TargetFileReader = () => Promise<string | undefined>

const ABSENT = /\b404\b|not found/iu

/** Reads the file from the default branch through the GitHub contents API. */
export function apiFileReader(run: RunTextCommand, repo: string): TargetFileReader {
  return async () => {
    try {
      return await run([
        'api',
        '-H',
        'Accept: application/vnd.github.raw+json',
        `repos/${repo}/contents/${TARGET_CONFIG_FILE}`,
      ])
    } catch (error) {
      if (error instanceof Error && ABSENT.test(error.message)) return undefined
      throw error
    }
  }
}

/**
 * Reads the file from a clone's remote default branch, never its working tree or checked-out head.
 * A clone with no remote default branch falls back to `fallback`, because its `HEAD` may be the
 * pull request.
 */
export function gitFileReader(
  tree: string,
  git: RunTextCommand,
  fallback: TargetFileReader,
): TargetFileReader {
  return async () => {
    const ref = await defaultRef(tree, git)
    return ref === 'HEAD' ? fallback() : gitReader(tree, ref, git).read(TARGET_CONFIG_FILE)
  }
}

/** Parses the repository's file; a failed read or a bad file is a problem, never an error. */
export async function readTargetConfig(
  read: TargetFileReader,
  repo: string,
): Promise<TargetConfig> {
  const file = `${repo}/${TARGET_CONFIG_FILE}`
  try {
    const text = await read()
    if (text === undefined) return { config: undefined, problems: [] }
    const config = parseRepoConfig(text, file)
    return { config, problems: config.problems }
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).split('\n')[0]
    return { config: undefined, problems: [`${file}: could not be read (${reason}); ignored`] }
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

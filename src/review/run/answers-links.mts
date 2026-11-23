import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const REPOSITORY_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/u

/**
 * The GitHub repository a plugin records in its `.claude-plugin/plugin.json`, as
 * `https://github.com/<owner>/<repo>`; undefined when it records none, or another host.
 */
export function pluginRepository(installPath: string): string | undefined {
  let manifest: { repository?: unknown } | null
  try {
    manifest = JSON.parse(readFileSync(join(installPath, '.claude-plugin', 'plugin.json'), 'utf8'))
  } catch {
    return undefined
  }
  const raw = manifest?.repository
  const url = typeof raw === 'object' && raw !== null ? (raw as { url?: unknown }).url : raw
  if (typeof url !== 'string') return undefined
  const repository = url.replace(/\/$/u, '').replace(/\.git$/u, '')
  return REPOSITORY_RE.test(repository) ? repository : undefined
}

/**
 * The link of a skill whose SKILL.md is `file`, in a plugin whose root is the repository root;
 * undefined without a repository, so no link is ever guessed.
 */
export function skillUrl(repository: string | undefined, file: string): string | undefined {
  return repository === undefined
    ? undefined
    : `${repository}/blob/HEAD/skills/${basename(dirname(file))}/SKILL.md`
}

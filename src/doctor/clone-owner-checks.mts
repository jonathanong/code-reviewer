import { join } from 'node:path'

import { AppNotInstalledError } from '../gh-cli/index.mts'
import { PROBE_TIMEOUT_MS } from './probe.mts'
import { mapBounded, reasonOf } from './pool.mts'
import type { Check, Context, DoctorIo } from './types.mts'

/** How many `git remote get-url` calls run at once. */
const REMOTE_CONCURRENCY = 4

/** The GitHub owner of a remote URL (https or ssh); undefined for another host or a shape that is not `owner/name`. */
export function githubOwner(url: string): string | undefined {
  return /github\.com[/:]([\w.-]+)\/[\w.-]+?(?:\.git)?\/?$/iu.exec(url.trim())?.[1]
}

/** The clone root: `--clones`, else `CODE_REVIEWER_CLONE_ROOT`. */
const rootOf = ({ io, flags }: Context): string | undefined =>
  flags.clones ?? (io.env.CODE_REVIEWER_CLONE_ROOT || undefined)

/** Whether the machine config holds settings for `owner`, in its own file or for any of its repositories. */
function hasOwnerConfig(io: DoctorIo, owner: string): boolean | undefined {
  try {
    const { byOwner, byRepo } = io.configs()
    const key = owner.toLowerCase()
    return byOwner.has(key) || [...byRepo.keys()].some((repo) => repo.startsWith(`${key}/`))
  } catch {
    // The `machine-config` check reports an unreadable directory; there is nothing to compare here.
    return undefined
  }
}

/** The owner of each git checkout directly under `root`, from its `origin` remote alone, grouped with the checkouts' names. */
async function ownersOf(
  io: DoctorIo,
  root: string,
  entries: string[],
): Promise<Map<string, string[]>> {
  const names = entries
    .filter((name) => io.fs.mtimeMs(join(root, name, '.git')) !== undefined)
    .sort()
  const owners = await mapBounded(names, REMOTE_CONCURRENCY, async (name) => {
    try {
      const url = await io.exec('git', ['-C', join(root, name), 'remote', 'get-url', 'origin'], {
        timeoutMs: PROBE_TIMEOUT_MS,
      })
      return githubOwner(url)
    } catch {
      return undefined
    }
  })
  const byOwner = new Map<string, string[]>()
  names.forEach((name, index) => {
    const owner = owners[index]
    if (owner !== undefined) byOwner.set(owner, [...(byOwner.get(owner) ?? []), name])
  })
  return byOwner
}

/** Whether an App is configured; a config that does not parse is the `github-app` check's to report. */
function appConfigured(io: DoctorIo): boolean {
  try {
    return io.loadApp() !== undefined
  } catch {
    return false
  }
}

/** With an App configured and the network allowed: why the App cannot act for `owner`, else undefined. */
async function installProblem(io: DoctorIo, owner: string): Promise<string | undefined> {
  try {
    await io.checkInstallation(owner)
    return undefined
  } catch (error) {
    return error instanceof AppNotInstalledError
      ? 'the GitHub App is configured but not installed for it'
      : `could not check the GitHub App installation: ${reasonOf(error)}`
  }
}

/**
 * Warns about a clone whose GitHub owner this machine is not set up for: no machine config for the
 * owner, or the configured App not installed there. It reads remotes only and asks GitHub once
 * per distinct owner, and not at all with `--offline` or without an App.
 */
export async function cloneOwnerChecks(ctx: Context): Promise<Check[]> {
  const { io, flags } = ctx
  const root = rootOf(ctx)
  const entries = root === undefined ? undefined : io.fs.list(root)
  if (root === undefined || entries === undefined) return []
  const owners = await ownersOf(io, root, entries)
  const askApp = !flags.offline && appConfigured(io)
  const checks: Check[] = []
  for (const [owner, clones] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
    const problems: string[] = []
    const fixes: string[] = []
    if (hasOwnerConfig(io, owner) === false) {
      problems.push('no machine config for it')
      fixes.push(`add ${join(io.configDir, `${owner}.yaml`)} (or .json) for ${owner}`)
    }
    const app = askApp ? await installProblem(io, owner) : undefined
    if (app !== undefined) {
      problems.push(app)
      fixes.push(`install the App for ${owner}`)
    }
    if (problems.length > 0) {
      checks.push({
        name: `clone-owner:${owner}`,
        status: 'warn',
        detail: `${owner} (clones: ${clones.join(', ')}): ${problems.join('; ')}`,
        fix: fixes.join('; '),
      })
    }
  }
  if (checks.length > 0) return checks
  const count = [...owners.values()].reduce((sum, clones) => sum + clones.length, 0)
  return [
    {
      name: 'clone-owners',
      status: 'ok',
      detail: `${count} clone${count === 1 ? '' : 's'} under ${root}, for ${owners.size} GitHub owner${owners.size === 1 ? '' : 's'}, all set up`,
    },
  ]
}

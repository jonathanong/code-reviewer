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

/**
 * Whether the machine config has an owner file for `owner`. Per-repository files do not count:
 * without the owner file, the owner's other repositories run on the built-in defaults.
 */
function hasOwnerConfig(io: DoctorIo, owner: string): boolean | undefined {
  try {
    return io.configs().byOwner.has(owner.toLowerCase())
  } catch {
    // The `machine-config` check reports an unreadable directory; there is nothing to compare here.
    return undefined
  }
}

type Remotes = {
  /** GitHub owner to the names of its checkouts. */
  owners: Map<string, string[]>
  /** Paths of checkouts whose `origin` could not be read. A remote on another host is not one. */
  unreadable: string[]
}

/** The owner of each git checkout directly under `root`, from its `origin` remote alone. */
async function remotesOf(io: DoctorIo, root: string, entries: string[]): Promise<Remotes> {
  const names = entries
    .filter((name) => io.fs.mtimeMs(join(root, name, '.git')) !== undefined)
    .sort()
  const found = await mapBounded(names, REMOTE_CONCURRENCY, async (name) => {
    try {
      const url = await io.exec('git', ['-C', join(root, name), 'remote', 'get-url', 'origin'], {
        timeoutMs: PROBE_TIMEOUT_MS,
      })
      return { name, owner: githubOwner(url) }
    } catch {
      return { name, owner: null }
    }
  })
  const owners = new Map<string, string[]>()
  const unreadable: string[] = []
  for (const { name, owner } of found) {
    if (owner === null) unreadable.push(join(root, name))
    else if (owner !== undefined) owners.set(owner, [...(owners.get(owner) ?? []), name])
  }
  return { owners, unreadable }
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
 * Warns about a clone whose GitHub owner this machine is not set up for: no owner config file for the
 * owner, or the configured App not installed there. It reads remotes only and asks GitHub once
 * per distinct owner, and not at all with `--offline` or without an App. A clone whose remote
 * cannot be read is a warning naming its path; a remote on another host is skipped.
 */
export async function cloneOwnerChecks(ctx: Context): Promise<Check[]> {
  const { io, flags } = ctx
  const root = rootOf(ctx)
  const entries = root === undefined ? undefined : io.fs.list(root)
  if (root === undefined || entries === undefined) return []
  const { owners, unreadable } = await remotesOf(io, root, entries)
  const askApp = !flags.offline && appConfigured(io)
  const checks: Check[] = []
  for (const [owner, clones] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
    const problems: string[] = []
    const fixes: string[] = []
    if (hasOwnerConfig(io, owner) === false) {
      problems.push(
        'no owner config file for it, so its other repositories run on built-in defaults',
      )
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
  for (const path of unreadable) {
    checks.push({
      name: `clone-remote:${path}`,
      status: 'warn',
      detail: `could not read the origin remote of ${path}, so its owner is unchecked`,
      fix: `git -C ${path} remote get-url origin`,
    })
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

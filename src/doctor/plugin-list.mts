import { parsePluginInstalls, type PluginInstall } from '../review/plugins.mts'
import { PROBE_TIMEOUT_MS } from './probe.mts'
import type { DoctorIo } from './types.mts'

/** What the install of one user-scope plugin records about itself. */
export type InstalledDetail = {
  version: string | undefined
  /** The commit the install was taken from, when the listing records one. */
  commit: string | undefined
  marketplace: string | undefined
}

export type PluginListing = {
  installs: PluginInstall[]
  details: Map<string, InstalledDetail>
}

type Raw = {
  id?: unknown
  scope?: unknown
  enabled?: unknown
  version?: unknown
  gitCommitSha?: unknown
}

const COMMIT = /^[0-9a-f]{7,40}$/u

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

/**
 * The enabled user-scope plugins from one `claude plugin list --json`: where each is installed
 * (the parser `run` uses), and the version and commit each records. A version that is itself a
 * commit id is the commit of an unversioned git plugin.
 */
export function parseListing(stdout: string): PluginListing {
  const installs = parsePluginInstalls(stdout)
  const details = new Map<string, InstalledDetail>()
  for (const entry of JSON.parse(stdout) as Array<Raw | null>) {
    const id = text(entry?.id)
    if (id === undefined || entry?.enabled !== true || entry.scope !== 'user') continue
    const [name = '', marketplace] = id.split('@')
    const version = text(entry.version)
    details.set(name, {
      version,
      commit:
        text(entry.gitCommitSha) ??
        (version !== undefined && COMMIT.test(version) ? version : undefined),
      marketplace,
    })
  }
  return { installs, details }
}

/** Lists the plugins through `claude`, bounded by a timeout. */
export async function listPlugins(io: DoctorIo): Promise<PluginListing> {
  const stdout = await io.exec('claude', ['plugin', 'list', '--json'], {
    timeoutMs: PROBE_TIMEOUT_MS * 2,
  })
  return parseListing(stdout)
}

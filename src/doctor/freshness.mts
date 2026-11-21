import { join } from 'node:path'

import type { InstalledDetail } from './plugin-list.mts'
import { reasonOf } from './pool.mts'
import type { Check, DoctorIo, Status } from './types.mts'

/** An install directory untouched for longer than this many days is reported as stale. */
export const STALE_AFTER_DAYS = 14

/** Bound on the one `git ls-remote` per plugin. */
export const REMOTE_TIMEOUT_MS = 8_000

const DAY_MS = 86_400_000

type Marketplaces = Record<string, { source?: { source?: string; repo?: string; url?: string } }>

/** The git remote the marketplace of an install was added from, or undefined when none is recorded. */
function remoteOf(io: DoctorIo, marketplace: string | undefined): string | undefined {
  const raw = io.fs.readText(join(io.claudeHome, 'plugins', 'known_marketplaces.json'))
  if (raw === undefined || marketplace === undefined) return undefined
  let known: Marketplaces
  try {
    known = JSON.parse(raw) as Marketplaces
  } catch {
    return undefined
  }
  const source = known[marketplace]?.source
  if (source?.source === 'github' && typeof source.repo === 'string') {
    return `https://github.com/${source.repo}.git`
  }
  return typeof source?.url === 'string' ? source.url : undefined
}

type Remote = { kind: 'behind' | 'current' | 'unchecked'; detail: string }

/** One `git ls-remote <remote> HEAD`; only an install with a recorded commit can be compared. */
async function compareRemote(io: DoctorIo, detail: InstalledDetail): Promise<Remote | undefined> {
  const remote = remoteOf(io, detail.marketplace)
  if (remote === undefined || detail.commit === undefined) return undefined
  try {
    const out = await io.exec('git', ['ls-remote', remote, 'HEAD'], {
      timeoutMs: REMOTE_TIMEOUT_MS,
    })
    const latest = out.trim().split(/\s+/u)[0] as string
    if (latest === '')
      return { kind: 'unchecked', detail: 'could not check: remote listed no HEAD' }
    const length = Math.min(latest.length, detail.commit.length)
    if (latest.slice(0, length) === detail.commit.slice(0, length)) {
      return { kind: 'current', detail: 'up to date with the remote' }
    }
    return {
      kind: 'behind',
      detail: `behind: installed ${detail.commit.slice(0, 7)}, latest ${latest.slice(0, 7)}`,
    }
  } catch (error) {
    return { kind: 'unchecked', detail: `could not check the remote: ${reasonOf(error)}` }
  }
}

/**
 * How current one rule plugin is: its version or commit, when its install directory last
 * changed, and, online, whether the remote it came from has moved on. Never a fail: auto-update
 * is expected to keep it current, so this is a safety net.
 */
export async function freshnessCheck(
  io: DoctorIo,
  name: string,
  installPath: string,
  detail: InstalledDetail,
  offline: boolean,
): Promise<Check> {
  const check = `plugin-freshness:${name}`
  const fix = `claude plugin update ${name}`
  const installed = detail.commit?.slice(0, 7) ?? detail.version ?? 'unknown version'
  const mtime = io.fs.mtimeMs(installPath)
  const days = mtime === undefined ? undefined : Math.floor((io.now().getTime() - mtime) / DAY_MS)
  const modified =
    days === undefined
      ? 'install directory time unknown'
      : `install directory modified ${days} days ago`
  const notes = [`installed ${installed}`, modified]
  let status: Status = 'ok'
  if (days !== undefined && days > STALE_AFTER_DAYS) {
    status = 'warn'
    notes.push(`older than ${STALE_AFTER_DAYS} days`)
  }
  const remote = offline ? undefined : await compareRemote(io, detail)
  if (remote !== undefined) {
    notes.push(remote.detail)
    if (remote.kind !== 'current') status = 'warn'
  }
  return status === 'ok'
    ? { name: check, status, detail: notes.join('; ') }
    : { name: check, status, detail: notes.join('; '), fix }
}

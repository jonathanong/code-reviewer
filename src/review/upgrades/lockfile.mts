import { isPackageName, parseVersion } from './version.mts'

export type LockedVersion = { integrity: string | undefined }
/** Registry packages of a lockfile: name, then version. */
export type LockedPackages = Map<string, Map<string, LockedVersion>>

export type ParsedLockfile = { packages: LockedPackages; problem?: string }

const MIN_LOCKFILE_VERSION = 6
const KEY = /^ {2}(?:'([^']+)'|"([^"]+)"|([^\s'"]\S*)):\s*$/u
const INTEGRITY = /\bintegrity:\s*(sha512-[A-Za-z0-9+/=]+)/u
const NOT_REGISTRY = /\b(?:tarball|commit|directory|repo|type):/u

/** `name@version` from a `packages:` key, without a leading slash or a peer suffix. */
function splitKey(key: string): { name: string; version: string } | undefined {
  const bare = key.replace(/^\//u, '').replace(/\(.*$/u, '')
  const at = bare.lastIndexOf('@')
  if (at <= 0) return undefined
  return { name: bare.slice(0, at), version: bare.slice(at + 1) }
}

function validKey(key: string): { name: string; version: string } | undefined {
  const parsed = splitKey(key)
  if (parsed === undefined) return undefined
  return isPackageName(parsed.name) && parseVersion(parsed.version) !== undefined
    ? parsed
    : undefined
}

/**
 * The registry packages a `pnpm-lock.yaml` lists under `packages:`, read line by line (lockfile
 * version 6 and later). A git, tarball, directory or link resolution is not a registry package, and
 * a name or version that is not valid is left out, so nothing else is ever requested.
 */
export function parsePnpmLockfile(text: string): ParsedLockfile {
  const packages: LockedPackages = new Map()
  const lockfileVersion = /^lockfileVersion:\s*['"]?(\d+)/mu.exec(text)?.[1]
  if (lockfileVersion === undefined || Number(lockfileVersion) < MIN_LOCKFILE_VERSION) {
    return {
      packages,
      problem: `lockfileVersion ${lockfileVersion ?? '(none)'} is not read (6 or later is)`,
    }
  }
  let inPackages = false
  let current: { name: string; version: string } | undefined
  for (const line of text.split('\n')) {
    if (/^\S/u.test(line)) {
      inPackages = line.startsWith('packages:')
      current = undefined
      continue
    }
    if (!inPackages) continue
    const key = KEY.exec(line)
    if (key !== null) {
      current = validKey(key[1] ?? key[2] ?? (key[3] as string))
      continue
    }
    if (current === undefined || !/^ {4}resolution:/u.test(line)) continue
    if (!NOT_REGISTRY.test(line)) {
      const versions = packages.get(current.name) ?? new Map<string, LockedVersion>()
      versions.set(current.version, { integrity: INTEGRITY.exec(line)?.[1] })
      packages.set(current.name, versions)
    }
    current = undefined
  }
  return { packages }
}

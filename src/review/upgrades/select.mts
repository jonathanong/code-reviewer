import type { LockedPackages } from './lockfile.mts'
import { compareVersions, crossesPreOne, parseVersion, type Version } from './version.mts'

export type Upgrade = {
  name: string
  from: Version
  to: Version
  /** Why it was picked: `security` (an auth or security package) and/or `pre-1.0` (a 0.x minor or a 0.x to 1.0). */
  reasons: ('security' | 'pre-1.0')[]
  /** The lockfile's integrity for each side; the tarballs are checked against them. */
  fromIntegrity: string | undefined
  toIntegrity: string | undefined
}

export type Selection = {
  selected: Upgrade[]
  /** Packages added or removed with no old or new version to compare. */
  unpaired: number
}

export const MAX_PACKAGES = 10

/** Name segments that put a package on an auth or security path; a segment, so `auth` is not in `authors`. */
const SECURITY_SEGMENTS: ReadonlySet<string> = new Set([
  'auth',
  'oauth',
  'oauth2',
  'oidc',
  'openid',
  'jwt',
  'jsonwebtoken',
  'jwk',
  'jwks',
  'jose',
  'jws',
  'saml',
  'passport',
  'session',
  'csrf',
  'xsrf',
  'crypto',
  'cryptography',
  'bcrypt',
  'bcryptjs',
  'argon2',
  'scrypt',
  'pbkdf2',
  'totp',
  'webauthn',
  'passkey',
  'sso',
  'cookie',
  'helmet',
])

function globMatch(pattern: string, name: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\/]/gu, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`, 'u').test(name)
}

/** Whether `name` is on an auth or security path: a built-in segment, or one of the configured name globs. */
export function isSecurityPackage(name: string, extra: readonly string[]): boolean {
  const segments = name.split(/[/@._-]/u)
  return (
    segments.some((segment) => SECURITY_SEGMENTS.has(segment)) ||
    extra.some((pattern) => globMatch(pattern, name))
  )
}

function newest(versions: Version[]): Version | undefined {
  return versions.toSorted(compareVersions).at(-1)
}

/**
 * The upgrades worth a look between two lockfiles: a package whose version changed on an auth or
 * security path, or one that crosses a minor while pre-1.0 (direct or transitive: the lockfile
 * lists both). A new version is paired with the newest removed version of its own major, or else
 * the newest removed one that is lower; a package added or removed outright has nothing to compare.
 */
export function selectUpgrades(
  base: LockedPackages,
  head: LockedPackages,
  extra: readonly string[],
): Selection {
  const found: Upgrade[] = []
  let unpaired = 0
  for (const [name, now] of head) {
    const before = base.get(name)
    const added = [...now.keys()].filter((version) => !before?.has(version))
    const removed = [...(before?.keys() ?? [])].filter((version) => !now.has(version))
    if (before === undefined || added.length === 0 || removed.length === 0) {
      if (added.length > 0) unpaired += 1
      continue
    }
    const old = removed.map((text) => parseVersion(text) as Version)
    for (const text of added) {
      const to = parseVersion(text) as Version
      const lower = old.filter((version) => compareVersions(version, to) < 0)
      const sameMajor = lower.filter((version) => version.major === to.major)
      const from = newest(sameMajor) ?? newest(lower)
      if (from === undefined) continue
      const reasons: Upgrade['reasons'] = [
        ...(isSecurityPackage(name, extra) ? (['security'] as const) : []),
        ...(crossesPreOne(from, to) ? (['pre-1.0'] as const) : []),
      ]
      if (reasons.length === 0) continue
      found.push({
        name,
        from,
        to,
        reasons,
        fromIntegrity: before.get(from.text)?.integrity,
        toIntegrity: now.get(to.text)?.integrity,
      })
    }
  }
  for (const name of base.keys()) if (!head.has(name)) unpaired += 1
  return { selected: found, unpaired }
}

/** The upgrades to read, security packages first, at most `MAX_PACKAGES`, and how many were left out. */
export function capUpgrades(found: readonly Upgrade[]): { selected: Upgrade[]; omitted: number } {
  const ordered = found.toSorted(
    (a, b) =>
      Number(b.reasons.includes('security')) - Number(a.reasons.includes('security')) ||
      a.name.localeCompare(b.name),
  )
  return {
    selected: ordered.slice(0, MAX_PACKAGES),
    omitted: Math.max(0, ordered.length - MAX_PACKAGES),
  }
}

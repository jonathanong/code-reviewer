export type Version = { major: number; minor: number; patch: number; text: string }

const SEMVER =
  /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-[0-9A-Za-z.-]{1,64})?(?:\+[0-9A-Za-z.-]{1,64})?$/u
/** The npm package-name rule, without the legacy uppercase names. */
const PACKAGE_NAME = /^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/u

/** A version as `major.minor.patch` (a prerelease or build suffix is kept in `text` only); undefined when it is not one. */
export function parseVersion(text: string): Version | undefined {
  const match = SEMVER.exec(text)
  if (match === null) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), text }
}

/** Whether `name` is a registry package name; a lockfile is pusher-controlled, so nothing else is fetched. */
export function isPackageName(name: string): boolean {
  return name.length <= 214 && PACKAGE_NAME.test(name)
}

/** Negative, zero or positive by major, minor, patch. */
export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

/** A move that leaves 0.x, or changes the minor while the major stays 0: either may break. */
export function crossesPreOne(from: Version, to: Version): boolean {
  if (from.major !== 0) return false
  return to.major !== 0 || to.minor !== from.minor
}

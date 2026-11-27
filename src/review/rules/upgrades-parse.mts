import { isRecord, parseSwitch, unknownKeys } from './settings-parse.mts'

/** The `upgrades` key. Absent means no package is ever fetched from the npm registry. */
export type UpgradesKey = { enabled: boolean; packages: string[] }

const PATTERN = /^[a-z0-9@~*][a-z0-9._~*/-]{0,213}$/u

/** The `upgrades` key; one with any problem is ignored whole, which leaves the step off. */
export function parseUpgrades(
  raw: unknown,
  where: string,
  problems: string[],
): UpgradesKey | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object; ignored`)
    return undefined
  }
  const found = unknownKeys(raw, ['enabled', 'packages'], where)
  const enabled = parseSwitch(raw.enabled, `${where}.enabled`, found)
  if (raw.enabled === undefined) found.push(`${where}.enabled: is required`)
  const packages = raw.packages ?? []
  const valid =
    Array.isArray(packages) &&
    packages.every((item) => typeof item === 'string' && PATTERN.test(item))
  if (!valid) {
    found.push(`${where}.packages: must be a list of package names or globs such as @acme/*`)
  }
  if (found.length > 0 || enabled === undefined || !valid) {
    problems.push(...found.map((problem) => `${problem}; upgrades ignored`))
    return undefined
  }
  return { enabled, packages: packages as string[] }
}

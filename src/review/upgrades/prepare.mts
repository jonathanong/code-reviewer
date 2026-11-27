import { mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { Write } from '../write-diff.mts'
import { changelogBetween } from './changelog.mts'
import { diffPackages } from './diff.mts'
import type { UpgradeIo } from './io.mts'
import { parsePnpmLockfile } from './lockfile.mts'
import { fetchTarball } from './registry.mts'
import { renderIndex, renderPackage, type Entry, type Read } from './render.mts'
import { capUpgrades, selectUpgrades, type Upgrade } from './select.mts'
import { unpackTarball } from './tarball.mts'

/** The directory in the run directory; `INDEX.md` lists the packages and one file holds each. */
export const UPGRADES_DIR = 'upgrades'
export const STEP_TIMEOUT_MS = 60_000
const MAX_LOCKFILES = 3
/** What all packages' diffs together may hold. */
const MAX_TOTAL_DIFF_CHARS = 200_000
const LOCKFILE = 'pnpm-lock.yaml'

/** The `upgrades` key: off until a machine config enables it. */
export type UpgradesConfig = { enabled: boolean; packages: string[] }

export type UpgradesInput = {
  tree: string | undefined
  baseSha: string
  headSha: string
  paths: readonly string[]
  config: UpgradesConfig | undefined
}

export type UpgradesResult = {
  written: string[]
  problems: string[]
  /** At least one upgrade qualified, whether or not the registry could be read. */
  found: boolean
}

export function clearUpgrades(out: string): void {
  rmSync(join(out, UPGRADES_DIR), { recursive: true, force: true })
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The upgrades the lockfile diff holds, from local git; the notes are why a lockfile was not read. */
async function selectFrom(
  io: UpgradeIo,
  input: UpgradesInput,
  tree: string,
  lockfiles: readonly string[],
  extra: readonly string[],
  notes: string[],
): Promise<{ found: Upgrade[]; unpaired: number }> {
  const base = await io.mergeBase(tree, input.baseSha, input.headSha)
  const found = new Map<string, Upgrade>()
  let unpaired = 0
  for (const path of lockfiles) {
    const [old, now] = await Promise.all([
      io.fileAt(tree, base, path),
      io.fileAt(tree, input.headSha, path),
    ])
    if (old === undefined || now === undefined) continue
    const [before, after] = [parsePnpmLockfile(old), parsePnpmLockfile(now)]
    const problem = before.problem ?? after.problem
    if (problem !== undefined) {
      notes.push(`\`${path}\`: ${problem}.`)
      continue
    }
    const selection = selectUpgrades(before.packages, after.packages, extra)
    unpaired += selection.unpaired
    for (const upgrade of selection.selected) {
      found.set(`${upgrade.name}@${upgrade.from.text}>${upgrade.to.text}`, upgrade)
    }
  }
  return { found: [...found.values()], unpaired }
}

async function readUpgrade(
  io: UpgradeIo,
  upgrade: Upgrade,
  signal: AbortSignal,
  diffBudget: number,
): Promise<Read> {
  try {
    const [oldBytes, newBytes] = await Promise.all([
      fetchTarball(io.fetcher, upgrade.name, upgrade.from.text, upgrade.fromIntegrity, signal),
      fetchTarball(io.fetcher, upgrade.name, upgrade.to.text, upgrade.toIntegrity, signal),
    ])
    const [before, after] = await Promise.all([unpackTarball(oldBytes), unpackTarball(newBytes)])
    const diff = await diffPackages(before, after, io.diffDirs, Math.min(diffBudget, 48_000))
    return { changelog: changelogBetween(after, upgrade.from, upgrade.to), diff }
  } catch (error) {
    return { failure: reason(error) }
  }
}

/**
 * For the packages of a lockfile diff that are on an auth or security path, or cross a pre-1.0
 * minor, writes `upgrades/INDEX.md` and one file each: the changelog entries between the two
 * versions and a bounded diff of the published files. Off unless the machine config enables it, and
 * only with a checkout and a changed `pnpm-lock.yaml`. Everything is read from local git and the
 * npm registry. It never throws: a package the registry cannot give is a note in its file and a
 * problem, and the review goes on.
 */
export async function prepareUpgrades(
  io: UpgradeIo,
  out: string,
  write: Write,
  input: UpgradesInput,
): Promise<UpgradesResult> {
  const none: UpgradesResult = { written: [], problems: [], found: false }
  const { tree, config } = input
  const lockfiles = input.paths
    .filter((path) => basename(path) === LOCKFILE)
    .slice(0, MAX_LOCKFILES)
  if (config === undefined || !config.enabled || tree === undefined || lockfiles.length === 0)
    return none
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS)
  try {
    const notes: string[] = []
    const { found, unpaired } = await selectFrom(io, input, tree, lockfiles, config.packages, notes)
    if (unpaired > 0) {
      notes.push(
        `${unpaired} packages were added or removed with no old or new version to compare.`,
      )
    }
    if (found.length === 0) return none
    const { selected, omitted } = capUpgrades(found)
    if (omitted > 0)
      notes.push(`${omitted} more qualifying upgrades are not read (limit ${selected.length}).`)
    const entries: Entry[] = []
    let budget = MAX_TOTAL_DIFF_CHARS
    for (const upgrade of selected) {
      const read = await readUpgrade(io, upgrade, controller.signal, budget)
      if ('diff' in read) budget -= read.diff.text.length
      entries.push({ upgrade, ...read })
    }
    const dir = join(out, UPGRADES_DIR)
    mkdirSync(dir, { recursive: true })
    const names = entries.map(
      (entry, index) => `${index + 1}-${entry.upgrade.name.replace(/[@/]/gu, '_')}.md`,
    )
    entries.forEach((entry, index) =>
      write(join(dir, names[index] as string), renderPackage(entry)),
    )
    write(join(dir, 'INDEX.md'), renderIndex(entries, names, notes))
    const failed = entries.filter((entry) => 'failure' in entry)
    return {
      written: [`${UPGRADES_DIR}/INDEX.md`, ...names.map((name) => `${UPGRADES_DIR}/${name}`)],
      problems:
        failed.length === 0
          ? []
          : [
              `The npm registry could not give ${failed.length} of ${entries.length} upgraded packages: ${(failed[0] as { failure: string }).failure}`,
            ],
      found: true,
    }
  } catch (error) {
    return { ...none, problems: [`The check of dependency upgrades failed: ${reason(error)}`] }
  } finally {
    clearTimeout(timer)
  }
}

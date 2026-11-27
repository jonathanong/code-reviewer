import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

import type { PackageFiles } from './tarball.mts'

export const MAX_DIFF_CHARS = 48_000
const MAX_FILE_BYTES = 256 * 1024
const MAX_LISTED = 10

/** Diffs the `old` and `new` directories of `parent`; resolves the patch text, empty when none differ. */
export type DiffDirs = (parent: string) => Promise<string>

export type PackageDiff = {
  /** The patch, `package.json` first, then type declarations, then the rest. */
  text: string
  /** What was left out or cut, one line each. */
  notes: string[]
}

function leftOut(path: string, content: Buffer | undefined): string | undefined {
  if (path.endsWith('.map')) return 'source map'
  if (content === undefined) return undefined
  if (content.length > MAX_FILE_BYTES) return 'over 256 KB'
  return content.subarray(0, 8000).includes(0) ? 'binary' : undefined
}

/** The order by the `diff --git` line: `package.json`, then type declarations, then the rest. */
function rank(header: string): number {
  if (header.endsWith(' b/new/package.json')) return 0
  return /\.d\.[cm]?ts$/u.test(header) ? 1 : 2
}

/** The patch cut into one piece per file and put in the order a reader needs, then cut at a line. */
function ordered(patch: string): string[] {
  const pieces = patch.split(/^(?=diff --git )/mu).filter((piece) => piece.trim() !== '')
  const keyed = pieces.map((piece) => {
    const header = piece.split('\n', 1)[0] as string
    return { piece, key: rank(header), header }
  })
  return keyed
    .toSorted((a, b) => a.key - b.key || a.header.localeCompare(b.header))
    .map(({ piece }) => piece)
}

/**
 * The published files that differ between two versions, as a patch of at most `limit` characters.
 * Source maps, binaries and files over 256 KB are named, not diffed. The files are written to a
 * fresh temporary directory (paths were made relative to the package root when unpacked) and
 * removed afterwards.
 */
export async function diffPackages(
  before: PackageFiles,
  after: PackageFiles,
  diffDirs: DiffDirs,
  limit = MAX_DIFF_CHARS,
): Promise<PackageDiff> {
  const notes: string[] = []
  const skipped: string[] = []
  const changed: string[] = []
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const [old, now] = [before.get(path), after.get(path)]
    if (old !== undefined && now !== undefined && old.equals(now)) continue
    const why = leftOut(path, old) ?? leftOut(path, now)
    if (why === undefined) changed.push(path)
    else skipped.push(`${path} (${why})`)
  }
  if (skipped.length > 0) {
    const shown = skipped.toSorted().slice(0, MAX_LISTED).join(', ')
    notes.push(
      `${skipped.length} changed files are not diffed: ${shown}${skipped.length > MAX_LISTED ? ', ...' : ''}.`,
    )
  }
  if (changed.length === 0) return { text: '', notes }
  const parent = mkdtempSync(join(tmpdir(), 'upgrade-diff-'))
  try {
    for (const [side, files] of [
      ['old', before],
      ['new', after],
    ] as const) {
      mkdirSync(join(parent, side), { recursive: true })
      for (const path of changed) {
        const content = files.get(path)
        const target = resolve(parent, side, path)
        if (content === undefined || !target.startsWith(resolve(parent, side) + sep)) continue
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content)
      }
    }
    const pieces = ordered(await diffDirs(parent))
    let text = ''
    for (const [index, piece] of pieces.entries()) {
      if (text.length + piece.length > limit) {
        const room = limit - text.length
        text += piece.slice(0, Math.max(0, piece.slice(0, room).lastIndexOf('\n') + 1))
        notes.push(
          `The diff is cut at ${limit} characters; ${pieces.length - index} of ${pieces.length} changed files are partly or wholly missing.`,
        )
        break
      }
      text += piece
    }
    return { text, notes }
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
}

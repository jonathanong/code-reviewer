import { reviewableLines } from '../../triggers.mts'
import { kindOf, topDir } from './classify.mts'
import { coverage, groupHunks, hunkSignature } from './signature.mts'
import type { Caps, ChangeShape, CommitShape, FileChange, Hunk, Tally } from './types.mts'

/** A signature must cover at least this many hunks to count as repetition. */
export const MIN_REPEAT = 3
const TOP = 3
/** Commits listed with their sizes. */
export const COMMITS_LISTED = 12

const isGeneratedKind = (path: string): boolean => ['generated', 'lockfile'].includes(kindOf(path))

function tally(files: readonly FileChange[], nameOf: (path: string) => string): Tally[] {
  const by = new Map<string, Tally>()
  for (const file of files) {
    const name = nameOf(file.path)
    const row = by.get(name) ?? { name, files: 0, added: 0, deleted: 0 }
    row.files += 1
    row.added += file.added
    row.deleted += file.deleted
    by.set(name, row)
  }
  return [...by.values()].sort((a, b) => b.added + b.deleted - (a.added + a.deleted))
}

export type Measured = {
  files: FileChange[]
  hunks: Hunk[]
  /** Lines per path of `git diff -w --numstat`; a file missing there changed only in whitespace. */
  wLines: Map<string, { added: number; deleted: number }>
  patchTruncated: boolean
  hunksTruncated: boolean
  commits: CommitShape[]
  commitsCapped: boolean
  configs: ChangeShape['configs']
}

/** Changed lines that are whitespace-only, from numstat with and without `-w`; never negative. */
export function whitespaceShare(
  files: readonly FileChange[],
  wLines: Map<string, { added: number; deleted: number }>,
): ChangeShape['whitespace'] {
  let of = 0
  let kept = 0
  let vanished = 0
  for (const file of files.filter((f) => !isGeneratedKind(f.path))) {
    const lines = file.added + file.deleted
    const w = wLines.get(file.path)
    const remaining = w === undefined ? 0 : w.added + w.deleted
    of += lines
    kept += Math.min(lines, remaining)
    if (lines > 0 && remaining === 0) vanished += 1
  }
  return { lines: of - kept, of, files: vanished }
}

/** Pure: turns measured git output into the facts of the section. */
export function summarize(m: Measured, caps: Caps): ChangeShape {
  const analysed = m.hunks.filter((hunk) => !isGeneratedKind(hunk.path))
  const repeated = groupHunks(analysed).filter((group) => group.hunks >= MIN_REPEAT)
  const top = repeated.slice(0, TOP)
  const listed = new Set(top.map((group) => group.signature))
  const concerns = new Map<string, number>()
  for (const hunk of analysed) {
    if (listed.has(hunkSignature(hunk))) continue
    const dir = topDir(hunk.path)
    concerns.set(dir, (concerns.get(dir) ?? 0) + 1)
  }
  const sum = (files: readonly FileChange[], key: 'added' | 'deleted'): number =>
    files.reduce((total, file) => total + file[key], 0)
  const capNotes: string[] = []
  if (m.patchTruncated) capNotes.push(`the patch was cut at ${caps.patchBytes} characters`)
  if (m.hunksTruncated) capNotes.push(`only the first ${caps.hunks} hunks were analysed`)
  if (m.commitsCapped) capNotes.push(`only ${caps.commits} commits were read`)
  return {
    files: m.files.length,
    added: sum(m.files, 'added'),
    deleted: sum(m.files, 'deleted'),
    reviewableLines: reviewableLines(
      m.files.map((file) => ({ path: file.path, lines: file.added + file.deleted })),
    ),
    byDir: tally(m.files, topDir),
    byKind: tally(m.files, kindOf),
    hunks: analysed.length,
    top,
    top1Share: coverage(repeated, 1, analysed.length),
    top3Share: coverage(repeated, TOP, analysed.length),
    renames: m.files.filter((file) => file.status === 'R100').length,
    whitespace: whitespaceShare(m.files, m.wLines),
    configs: m.configs,
    commits: {
      total: m.commits.length,
      capped: m.commitsCapped,
      listed: m.commits.slice(0, COMMITS_LISTED),
    },
    concerns: [...concerns]
      .map(([dir, hunks]) => ({ dir, hunks }))
      .sort((a, b) => b.hunks - a.hunks),
    capNotes,
  }
}

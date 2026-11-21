/** Old-side line ranges of one file's hunks, from `git diff -U0`. */
export type FileRanges = { path: string; ranges: { start: number; count: number }[] }

/** One earlier commit that last touched some of the blamed lines. */
export type BlamedCommit = { sha: string; time: number; subject: string; lines: number }

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/u
const BLAME_HEADER = /^([0-9a-f]{40}) \d+ \d+/u

/** Files with their old-side ranges; files the diff only adds, and binary files, are left out. */
export function parseDiffRanges(diff: string): FileRanges[] {
  const files: FileRanges[] = []
  let current: FileRanges | null = null
  // A deleted line that starts with "-- " also reads `--- `; only the line after `diff --git` is a header.
  let header = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = null
      header = true
    } else if (header && line.startsWith('--- ')) {
      header = false
      const old = line.slice(4)
      if (old !== '/dev/null') {
        current = { path: old.replace(/^a\//u, ''), ranges: [] }
        files.push(current)
      }
    } else if (current !== null) {
      const match = HUNK.exec(line)
      const count = match?.[2] === undefined ? 1 : Number(match[2])
      if (match !== null && count > 0) current.ranges.push({ start: Number(match[1]), count })
    }
  }
  return files.filter((file) => file.ranges.length > 0)
}

/** The distinct commits in `git blame --porcelain` output, newest first, with the lines each owns. */
export function parseBlame(porcelain: string): BlamedCommit[] {
  const commits = new Map<string, BlamedCommit>()
  let current: BlamedCommit | undefined
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('\t')) {
      if (current !== undefined) current.lines += 1
      continue
    }
    const header = BLAME_HEADER.exec(line)
    if (header !== null) {
      const sha = header[1] as string
      current = commits.get(sha) ?? { sha, time: 0, subject: '', lines: 0 }
      commits.set(sha, current)
    } else if (current !== undefined && line.startsWith('committer-time ')) {
      current.time = Number(line.slice(15))
    } else if (current !== undefined && line.startsWith('summary ')) {
      current.subject = line.slice(8)
    }
  }
  return [...commits.values()].sort((a, b) => b.time - a.time)
}

/** The pull request number a squash-merge subject ends with, as in `Fix x (#12)`. */
export function prNumber(subject: string): number | null {
  const match = /\(#(\d+)\)$/u.exec(subject.trim())
  return match === null ? null : Number(match[1])
}

/** `YYYY-MM-DD` in UTC. */
export const isoDate = (seconds: number): string =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

/** Subjects come from repository history; keep them on one short line. */
export const shortSubject = (subject: string): string =>
  subject.length > 100 ? `${subject.slice(0, 97)}...` : subject

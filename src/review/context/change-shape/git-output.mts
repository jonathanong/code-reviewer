import type { CommitShape, FileChange } from './types.mts'

const count = (text: string | undefined): number => {
  const n = Number(text)
  return Number.isInteger(n) ? n : 0
}

type Lines = { added: number; deleted: number }

/** Parses `--numstat -z` into lines per final path; binary files count 0 lines. */
export function parseNumstat(numstatZ: string): Map<string, Lines> {
  const lines = new Map<string, Lines>()
  const queue = numstatZ.split('\0')
  for (let token = queue.shift(); token !== undefined; token = queue.shift()) {
    const [added, deleted, path] = token.split('\t')
    if (deleted === undefined) continue
    let finalPath = path
    if (path === '') {
      // A rename is `added\tdeleted\t`, then the old and new path as separate tokens.
      queue.shift()
      finalPath = queue.shift()
    }
    if (finalPath !== undefined)
      lines.set(finalPath, { added: count(added), deleted: count(deleted) })
  }
  return lines
}

/** Joins `--numstat -z` and `--name-status -z` into one list. */
export function parseFileChanges(numstatZ: string, nameStatusZ: string): FileChange[] {
  const lines = parseNumstat(numstatZ)
  const files: FileChange[] = []
  const queue = nameStatusZ.split('\0')
  for (let status = queue.shift(); status !== undefined; status = queue.shift()) {
    if (status === '') continue
    const moved = status.startsWith('R') || status.startsWith('C')
    const from = queue.shift() as string
    const path = moved ? (queue.shift() as string) : from
    const change = lines.get(path) ?? { added: 0, deleted: 0 }
    files.push({ path, status, ...change, ...(moved ? { oldPath: from } : {}) })
  }
  return files
}

/** Parses `git log --format=%x01%h %s --numstat`; commits come out in the log's order. */
export function parseCommits(log: string): CommitShape[] {
  return log
    .split('\u0001')
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [header = '', ...rows] = chunk.split('\n')
      const space = header.indexOf(' ')
      const shape: CommitShape = {
        id: space === -1 ? header : header.slice(0, space),
        subject: space === -1 ? '' : header.slice(space + 1),
        files: 0,
        added: 0,
        deleted: 0,
      }
      for (const row of rows) {
        const [added, deleted, path] = row.split('\t')
        if (path === undefined) continue
        shape.files += 1
        shape.added += count(added)
        shape.deleted += count(deleted)
      }
      return shape
    })
}

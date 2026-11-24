import { splitDiff } from './diff-files.mts'

export type DeltaFile = {
  path: string
  added: number
  removed: number
  patch: string
}

export type CarryComparison = {
  identical: boolean
  files: DeltaFile[]
  patch: string
}

const MAX_LCS_CELLS = 250_000

function bodyLines(text: string): string[] {
  const result: string[] = []
  let inHunk = false
  for (const line of text.trimEnd().split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (inHunk) {
      result.push(line)
      continue
    }
    if (
      line.startsWith('diff --git ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      continue
    }
    result.push(line)
  }
  return result
}

function filesByPath(diff: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const file of splitDiff(diff.trimEnd())) {
    map.set(file.path, bodyLines(file.text))
  }
  return map
}

type DiffOp = { kind: 'old' | 'new'; line: string }

function lcsDiff(oldLines: readonly string[], newLines: readonly string[]): DiffOp[] {
  let start = 0
  const minLen = Math.min(oldLines.length, newLines.length)
  while (start < minLen && oldLines[start] === newLines[start]) start += 1
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd -= 1
    newEnd -= 1
  }
  const a = oldLines.slice(start, oldEnd)
  const b = newLines.slice(start, newEnd)
  if (a.length * b.length > MAX_LCS_CELLS) {
    return [
      ...a.map((line): DiffOp => ({ kind: 'old', line })),
      ...b.map((line): DiffOp => ({ kind: 'new', line })),
    ]
  }
  const rows = a.length + 1
  const cols = b.length + 1
  const table = new Int32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j]
          ? (table[(i + 1) * cols + (j + 1)] as number) + 1
          : Math.max(table[(i + 1) * cols + j] as number, table[i * cols + (j + 1)] as number)
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
    } else if ((table[(i + 1) * cols + j] as number) >= (table[i * cols + (j + 1)] as number)) {
      ops.push({ kind: 'old', line: a[i] as string })
      i += 1
    } else {
      ops.push({ kind: 'new', line: b[j] as string })
      j += 1
    }
  }
  while (i < a.length) {
    ops.push({ kind: 'old', line: a[i] as string })
    i += 1
  }
  while (j < b.length) {
    ops.push({ kind: 'new', line: b[j] as string })
    j += 1
  }
  return ops
}

function fileDelta(
  path: string,
  oldLines: readonly string[],
  newLines: readonly string[],
  fromShort: string,
  headShort: string,
): DeltaFile | undefined {
  const ops = lcsDiff(oldLines, newLines)
  if (ops.length === 0) return undefined
  let added = 0
  let removed = 0
  const patchLines = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path} (${fromShort})`,
    `+++ b/${path} (${headShort})`,
  ]
  for (const op of ops) {
    if (op.kind === 'old') {
      if (op.line.startsWith('+')) {
        patchLines.push(`-${op.line.slice(1)}`)
        removed += 1
      } else if (op.line.startsWith('-')) {
        patchLines.push(`+${op.line.slice(1)}`)
        added += 1
      } else {
        patchLines.push(`-${op.line}`)
      }
    } else if (op.line.startsWith('+')) {
      patchLines.push(`+${op.line.slice(1)}`)
      added += 1
    } else if (op.line.startsWith('-')) {
      patchLines.push(`-${op.line.slice(1)}`)
      removed += 1
    } else {
      patchLines.push(`+${op.line}`)
    }
  }
  return { path, added, removed, patch: `${patchLines.join('\n')}\n` }
}

/**
 * Compares two zero-context diffs per file, ignoring hunk positions and blob hashes. Returns
 * whether they are identical and, when they differ, each differing file's line counts and patch.
 */
export function compareDiffs(
  oldDiff: string,
  newDiff: string,
  fromSha: string,
  headSha: string,
): CarryComparison {
  const oldFiles = filesByPath(oldDiff)
  const newFiles = filesByPath(newDiff)
  const paths = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort()
  const fromShort = fromSha.slice(0, 12)
  const headShort = headSha.slice(0, 12)
  const files: DeltaFile[] = []
  for (const path of paths) {
    const delta = fileDelta(
      path,
      oldFiles.get(path) ?? [],
      newFiles.get(path) ?? [],
      fromShort,
      headShort,
    )
    if (delta !== undefined) files.push(delta)
  }
  return { identical: files.length === 0, files, patch: files.map((file) => file.patch).join('') }
}

/** Human-readable delta summary and patch printed when diffs differ without `--allow-delta`. */
export function formatDelta(comparison: CarryComparison, fromSha: string, headSha: string): string {
  const noun = comparison.files.length === 1 ? 'file' : 'files'
  const header = `Delta between ${fromSha.slice(0, 12)} and ${headSha.slice(0, 12)} (${comparison.files.length} ${noun}):`
  const list = comparison.files.map((file) => `  +${file.added} -${file.removed} ${file.path}`)
  return `${[header, ...list, ''].join('\n')}\n${comparison.patch}`
}

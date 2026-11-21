import type { Hunk } from './types.mts'

/** Cuts `text` to at most `max` characters at a line end; reports whether it cut. */
export function capText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  const cut = text.lastIndexOf('\n', max)
  return { text: text.slice(0, cut === -1 ? max : cut), truncated: true }
}

/** The path of a `+++` or `---` line without its `a/` or `b/`; `/dev/null` gives an empty path. */
function pathOf(line: string): string {
  const raw = line.slice(4).replace(/\t.*$/u, '')
  if (raw === '/dev/null') return ''
  return raw.replace(/^[ab]\//u, '').replace(/^"|"$/gu, '')
}

/** Parses a `-U0` patch into hunks of verbatim lines; stops at `maxHunks`. */
export function parseHunks(patch: string, maxHunks: number): { hunks: Hunk[]; truncated: boolean } {
  const hunks: Hunk[] = []
  let path = ''
  let oldPath = ''
  let current: Hunk | null = null
  let inFile = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inFile = false
      current = null
    } else if (!inFile && line.startsWith('--- ')) {
      oldPath = pathOf(line)
    } else if (!inFile && line.startsWith('+++ ')) {
      path = pathOf(line) || oldPath
    } else if (line.startsWith('@@')) {
      inFile = true
      if (hunks.length >= maxHunks) return { hunks, truncated: true }
      current = { path, removed: [], added: [] }
      hunks.push(current)
    } else if (current !== null && line.startsWith('-')) {
      current.removed.push(line.slice(1))
    } else if (current !== null && line.startsWith('+')) {
      current.added.push(line.slice(1))
    }
  }
  return { hunks, truncated: false }
}

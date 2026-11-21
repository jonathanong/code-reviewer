import { asRecord, asString } from '../tracker/json.mts'
import type { CommentData, OutcomesIo } from './types.mts'

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+/gmu

/** Whether any hunk of a unified `patch` touches the old-side lines `start` to `end`. */
export function patchTouches(patch: string, start: number, end: number): boolean {
  return [...patch.matchAll(HUNK_RE)].some((hunk) => {
    const first = Number(hunk[1])
    const last = first + Math.max(Number(hunk[2] ?? 1), 1) - 1
    return first <= end && last >= start
  })
}

async function viaGit(io: OutcomesIo, clone: string, head: string, c: CommentData) {
  const base = ['-C', clone, 'log', '--format=%H', `${c.oid}..${head}`]
  // A comment on the file as a whole has no lines: any later commit to the file counts.
  const tail =
    c.endLine === null ? ['--', c.path] : ['-s', '-L', `${c.startLine},${c.endLine}:${c.path}`]
  return (await io.git([...base, ...tail] as string[])).trim() !== ''
}

async function viaApi(io: OutcomesIo, repo: string, head: string, c: CommentData) {
  const [owner = '', name = ''] = repo.split('/')
  const text = await io.run(owner, name)(['api', `repos/${repo}/compare/${c.oid}...${head}`])
  const files = asRecord(JSON.parse(text)).files
  const file = (Array.isArray(files) ? files : []).map(asRecord).find((f) => f.filename === c.path)
  if (file === undefined) return false
  if (c.endLine === null) return true
  return patchTouches(asString(file.patch) ?? '', c.startLine as number, c.endLine)
}

/**
 * Whether a commit after the comment's own changed the commented lines: from the local clone when
 * there is one and it has both commits, else from the compare API. Rejects when neither can say.
 */
export async function changedSince(
  io: OutcomesIo,
  repo: string,
  head: string,
  c: CommentData,
): Promise<boolean> {
  if (c.oid === null || c.path === null || head === '') return false
  const clone = await io.findClone(repo)
  if (clone !== undefined) {
    try {
      return await viaGit(io, clone, head, c)
    } catch {
      // The clone lacks one of the commits; the API still knows.
    }
  }
  return viaApi(io, repo, head, c)
}

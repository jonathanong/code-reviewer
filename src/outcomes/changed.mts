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

const SHA_RE = /\b[0-9a-f]{7,40}\b/giu
/** Commits a reply may cite before the rest are ignored, so one reply cannot cost unbounded calls. */
export const MAX_CITED = 5

/** The distinct commit-like hex words in `bodies`, lowercased: candidates only, checked against history. */
export function citedShas(bodies: readonly string[]): string[] {
  const found = bodies.flatMap((body) => body.match(SHA_RE) ?? []).map((sha) => sha.toLowerCase())
  return [...new Set(found)].slice(0, MAX_CITED)
}

async function citedViaGit(
  io: OutcomesIo,
  clone: string,
  head: string,
  c: CommentData,
  shas: string[],
) {
  const args = ['-C', clone, 'log', '--format=%H', `${c.oid}..${head}`, '--', c.path]
  const touched = (await io.git(args as string[])).split('\n').map((line) => line.trim())
  return shas.some((sha) => touched.some((hash) => hash !== '' && hash.startsWith(sha)))
}

async function citedViaApi(
  io: OutcomesIo,
  repo: string,
  head: string,
  c: CommentData,
  shas: string[],
) {
  const [owner = '', name = ''] = repo.split('/')
  const run = io.run(owner, name)
  const text = await run(['api', `repos/${repo}/compare/${c.oid}...${head}`])
  const compared = asRecord(JSON.parse(text))
  const commits = (Array.isArray(compared.commits) ? compared.commits : [])
    .map((commit) => asString(asRecord(commit).sha) ?? '')
    .filter((sha) => shas.some((cited) => sha.startsWith(cited)))
  for (const sha of commits) {
    const files = asRecord(JSON.parse(await run(['api', `repos/${repo}/commits/${sha}`]))).files
    const list = Array.isArray(files) ? files : []
    if (list.some((file) => asRecord(file).filename === c.path)) return true
  }
  return false
}

/**
 * Whether one of `bodies` (the replies on a thread) cites a commit that came after the comment's own
 * and changed the commented file. The citation is only a candidate: the commit must exist after the
 * comment and touch the file, which a reply cannot make true. Rejects when neither the clone nor the
 * compare API can say.
 */
export async function citedFixSince(
  io: OutcomesIo,
  repo: string,
  head: string,
  c: CommentData,
  bodies: readonly string[],
): Promise<boolean> {
  const shas = citedShas(bodies)
  if (shas.length === 0 || c.oid === null || c.path === null || head === '') return false
  const clone = await io.findClone(repo)
  if (clone !== undefined) {
    try {
      return await citedViaGit(io, clone, head, c, shas)
    } catch {
      // The clone lacks one of the commits; the API still knows.
    }
  }
  return citedViaApi(io, repo, head, c, shas)
}

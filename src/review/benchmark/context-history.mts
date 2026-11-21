import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { buildContext, sectionsNamed } from '../context/build.mts'
import { ReviewError } from '../finding.mts'
import type { Exec } from './exec.mts'

/** One commit of a synthetic history: its message and the files it writes (path to full text). */
export type HistoryCommit = { message: string; files: Record<string, string> }

/**
 * A case built into a temporary git repository at run time: `base` commits, then `head` commits
 * (the change under review). A `{0}` in a message is the full sha of base commit 0.
 */
export type HistoryCase = {
  id: string
  title: string
  base: HistoryCommit[]
  head: HistoryCommit[]
  expect: {
    /** The base commit that last touched a changed line of `path` must be listed under it. */
    history: Array<{ commit: number; path: string }>
    /** Base commits the linked-regressions section must find. */
    linked: number[]
  }
}

const fail = (where: string, message: string): never => {
  throw new ReviewError(`${where}: ${message}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function commits(value: unknown, where: string, min: number): HistoryCommit[] {
  if (!Array.isArray(value) || value.length < min) fail(where, `needs at least ${min} commit(s)`)
  return (value as unknown[]).map((entry) => {
    const { message, files } = isRecord(entry) ? entry : {}
    if (typeof message !== 'string' || message === '' || !isRecord(files))
      return fail(where, 'a commit needs a message and files')
    const text = Object.values(files)
    if (text.length === 0 || text.some((item) => typeof item !== 'string'))
      return fail(where, 'a commit writes at least one file, each a string')
    return { message, files: files as Record<string, string> }
  })
}

const index = (value: unknown, size: number, where: string): number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < size
    ? (value as number)
    : fail(where, 'commit must index a base commit')

/** Parses git-history cases; ids must be unique. */
export function parseHistoryCases(raw: unknown): HistoryCase[] {
  if (!Array.isArray(raw)) throw new ReviewError('History cases must be a JSON array.')
  const cases = raw.map((entry: unknown, at): HistoryCase => {
    const where = `history[${at}]`
    const item = isRecord(entry) ? entry : fail(where, 'must be an object')
    const { id, title, expect } = item as Record<string, unknown>
    if (typeof id !== 'string' || typeof title !== 'string') fail(where, 'needs an id and a title')
    const base = commits(item.base, where, 1)
    const want = isRecord(expect) ? expect : fail(where, 'needs expect')
    const history = Array.isArray(want.history) ? (want.history as unknown[]) : []
    const linked = Array.isArray(want.linked) ? (want.linked as unknown[]) : []
    if (history.length + linked.length === 0) fail(where, 'expect must list something to find')
    return {
      id: id as string,
      title: title as string,
      base,
      head: commits(item.head, where, 1),
      expect: {
        history: history.map((row) => {
          const { commit, path } = isRecord(row) ? row : {}
          if (typeof path !== 'string') fail(where, 'expect.history rows need a path')
          return { commit: index(commit, base.length, where), path: path as string }
        }),
        linked: linked.map((commit) => index(commit, base.length, where)),
      },
    }
  })
  if (new Set(cases.map((item) => item.id)).size !== cases.length)
    throw new ReviewError('Duplicate history case id.')
  return cases
}

/** The history sections read only git, so a file read here is a mistake and says so. */
export const readNothing = async (path: string): Promise<string> => {
  throw new Error(`the history sections do not read files: ${path}`)
}

export type HistoryRow = { what: 'history' | 'linked'; detail: string; found: boolean }
export type HistoryCheck = { rows: HistoryRow[]; sectionChars: number }

const DAY = 86_400

/** Commits each of `list` in order; returns their full shas. Dates are fixed so shas repeat. */
async function commitAll(
  list: readonly HistoryCommit[],
  dir: string,
  exec: Exec,
  start: number,
  known: readonly string[],
): Promise<string[]> {
  const shas: string[] = []
  for (const [at, commit] of list.entries()) {
    for (const [path, text] of Object.entries(commit.files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    const message = commit.message.replace(/\{(\d+)\}/gu, (_, n: string) => known[Number(n)]!)
    const stamp = `${1_700_000_000 + (start + at) * DAY} +0000`
    await exec('git', ['add', '-A'], { cwd: dir })
    await exec('git', ['-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', message], {
      cwd: dir,
      env: { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp },
    })
    shas.push((await exec('git', ['rev-parse', 'HEAD'], { cwd: dir })).trim())
  }
  return shas
}

/**
 * Builds the case's repository in `dir` (an empty directory) and runs the changed-line-history
 * and linked-regressions builders on it, with git alone: no GitHub, no model.
 */
export async function checkHistory(
  item: HistoryCase,
  dir: string,
  exec: Exec,
): Promise<HistoryCheck> {
  const env = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
  const run: Exec = (command, args, options) =>
    exec(command, args, { ...options, env: { ...env, ...options?.env } })
  await run('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Bench'], { cwd: dir })
  await run('git', ['config', 'user.email', 'bench@example.com'], { cwd: dir })
  const base = await commitAll(item.base, dir, run, 0, [])
  await commitAll(item.head, dir, run, base.length, base)
  const headSha = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).trim()
  const built = await buildContext(
    { repo: '', pr: 0, tree: dir, baseSha: base.at(-1)!, headSha, out: dir, skills: [] },
    { exec: run, readFile: readNothing },
    sectionsNamed(['changed-line-history', 'linked-regressions']),
  )
  const section = (title: string) => built.sections.find((entry) => entry.title === title)
  const history = section('Changed-line history')?.body ?? ''
  const linked = section('Linked regressions')?.linked ?? []
  const rows: HistoryRow[] = [
    ...item.expect.history.map(({ commit, path }): HistoryRow => {
      const block = history.split('### ').find((part) => part.startsWith(`${path}\n`)) ?? ''
      return {
        what: 'history',
        detail: `${base[commit]!.slice(0, 7)} under ${path}`,
        found: block.includes(`\`${base[commit]!.slice(0, 7)}\``),
      }
    }),
    ...item.expect.linked.map((commit): HistoryRow => ({
      what: 'linked',
      detail: base[commit]!.slice(0, 7),
      found: linked.some((entry) => entry.sha === base[commit]),
    })),
  ]
  const sectionChars = built.sections.reduce((sum, entry) => sum + entry.body.length, 0)
  return { rows, sectionChars }
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Exec } from '../benchmark/exec.mts'
import { charLength } from '../focus.mts'
import { parseYamlConfig } from '../rules/yaml-config.mts'
import { pool } from './pool.mts'

export const MAX_FOCUS_FACT_FILES = 200
const GIT_TIMEOUT_MS = 30_000
const SHOW_JOBS = 8

type NumstatEntry = {
  path: string
  oldPath?: string
  binary: boolean
  added: number | null
  removed: number | null
}
type StatusEntry = { path: string; oldPath?: string; status: string }

export type FocusFileFact = {
  path: string
  oldPath?: string
  status: string | null
  binary: boolean
  added: number | null
  removed: number | null
  lines: number | null
  descriptionChars: number | null
}

export type FocusFacts = {
  titleChars: number | null
  descriptionChars: number | null
  /** Null when neither numstat nor name-status could be read from git. */
  files: { total: number; omitted: number; listed: FocusFileFact[] } | null
}

export type FocusFactsInput = {
  tree: string
  out: string
  baseSha?: string | undefined
  headSha?: string | undefined
  exec: Exec
  readFile?: (path: string) => string
}

const STATUS_NAME: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
}

const emptyFact = (
  path: string,
  oldPath: string | undefined,
  status: string | null,
): FocusFileFact => ({
  path,
  ...(oldPath === undefined ? {} : { oldPath }),
  status,
  binary: false,
  added: null,
  removed: null,
  lines: null,
  descriptionChars: null,
})

/** Counts lines in a text file; a trailing newline ends the last line without adding one. */
export function countLines(text: string): number {
  if (text === '') return 0
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n').length
}

/** Character length of a YAML frontmatter `description:` string, or null when absent or invalid. */
export function frontmatterDescriptionChars(text: string): number | null {
  const open = /^---\r?\n/u.exec(text)
  if (open === null) return null
  const rest = text.slice(open[0].length)
  const close = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/u.exec(rest)
  if (close === null) return null
  try {
    const parsed = parseYamlConfig(rest.slice(0, close.index))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const { description } = parsed as { description?: unknown }
    return typeof description === 'string' ? charLength(description) : null
  } catch {
    return null
  }
}

function parseNumstatZ(output: string): NumstatEntry[] {
  const entries: NumstatEntry[] = []
  const queue = output.split('\0')
  for (let token = queue.shift(); token !== undefined; token = queue.shift()) {
    const [rawAdded, rawRemoved, rawPath] = token.split('\t')
    if (rawRemoved === undefined) continue
    const renamed = rawPath === ''
    const oldPath = renamed ? (queue.shift() as string) : undefined
    const path = renamed ? (queue.shift() as string) : (rawPath as string)
    const binary = rawAdded === '-'
    entries.push({
      path,
      ...(oldPath === undefined ? {} : { oldPath }),
      binary,
      added: binary ? null : Number.parseInt(rawAdded as string, 10),
      removed: binary ? null : Number.parseInt(rawRemoved, 10),
    })
  }
  return entries
}

function parseNameStatusZ(output: string): StatusEntry[] {
  const entries: StatusEntry[] = []
  const queue = output.split('\0')
  for (let code = queue.shift(); code !== undefined; code = queue.shift()) {
    if (code === '') continue
    const renamed = code.startsWith('R')
    const from = queue.shift() as string
    const path = renamed ? (queue.shift() as string) : from
    const status = STATUS_NAME[code[0] as string] ?? code
    entries.push({ path, status, ...(renamed ? { oldPath: from } : {}) })
  }
  return entries
}

function mergeDiffEntries(
  numstat: readonly NumstatEntry[] | null,
  statuses: readonly StatusEntry[] | null,
): FocusFileFact[] | null {
  if (numstat === null && statuses === null) return null
  const byPath = new Map<string, FocusFileFact>()
  for (const entry of statuses ?? []) {
    byPath.set(entry.path, emptyFact(entry.path, entry.oldPath, entry.status))
  }
  for (const entry of numstat ?? []) {
    const fact = byPath.get(entry.path) ?? emptyFact(entry.path, entry.oldPath, null)
    fact.binary = entry.binary
    fact.added = entry.added
    fact.removed = entry.removed
    byPath.set(entry.path, fact)
  }
  return [...byPath.values()]
}

function readPrLengths(out: string, readFile: (path: string) => string) {
  try {
    const { title, intent } = JSON.parse(readFile(join(out, 'context.json'))) as {
      title?: unknown
      intent?: { body?: unknown }
    }
    return {
      titleChars: typeof title === 'string' ? charLength(title) : null,
      descriptionChars: typeof intent?.body === 'string' ? charLength(intent.body) : null,
    }
  } catch {
    return { titleChars: null, descriptionChars: null }
  }
}

async function tryGit(exec: Exec, tree: string, args: string[]): Promise<string | null> {
  try {
    return await exec('git', args, { cwd: tree, timeoutMs: GIT_TIMEOUT_MS })
  } catch {
    return null
  }
}

const changedLines = (file: FocusFileFact): number => (file.added ?? 0) + (file.removed ?? 0)

/** Computes deterministic change facts from local git and `context.json`; failures omit only that fact. */
export async function buildFocusFacts(input: FocusFactsInput): Promise<FocusFacts> {
  const pr = readPrLengths(input.out, input.readFile ?? ((path) => readFileSync(path, 'utf8')))
  if (input.baseSha === undefined || input.headSha === undefined) return { ...pr, files: null }
  const range = `${input.baseSha}...${input.headSha}`
  const [numstatRaw, statusRaw] = await Promise.all([
    tryGit(input.exec, input.tree, ['diff', '--numstat', '-z', '-M', range]),
    tryGit(input.exec, input.tree, ['diff', '--name-status', '-z', '-M', range]),
  ])
  const all = mergeDiffEntries(
    numstatRaw === null ? null : parseNumstatZ(numstatRaw),
    statusRaw === null ? null : parseNameStatusZ(statusRaw),
  )
  if (all === null) return { ...pr, files: null }
  const listed =
    all.length > MAX_FOCUS_FACT_FILES
      ? [...all].sort((a, b) => changedLines(b) - changedLines(a)).slice(0, MAX_FOCUS_FACT_FILES)
      : all
  const readable = listed.filter((file) => file.status !== 'deleted' && !file.binary)
  await pool(readable, SHOW_JOBS, async (file) => {
    const content = await tryGit(input.exec, input.tree, ['show', `${input.headSha}:${file.path}`])
    if (content === null) return
    file.lines = countLines(content)
    file.descriptionChars = frontmatterDescriptionChars(content)
  })
  return { ...pr, files: { total: all.length, omitted: all.length - listed.length, listed } }
}

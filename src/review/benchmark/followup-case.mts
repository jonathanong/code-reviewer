import { ReviewError } from '../finding.mts'
import type { FollowUpContext, PriorFinding } from '../context.mts'
import { renderFollowUpContext } from '../context-render.mts'
import type { PreviousReview } from '../context/types.mts'
import { contextFileLine, sinceFileLine } from '../run/pillar-prompt.mts'
import type { HeldEvidence } from '../run/evidence-reuse.mts'
import { FIXED_THREADS_LINES, previousLines } from '../run/previous-prompt.mts'

/** An earlier finding still open as a thread, labeled with what the since-diff does to it. */
export type FollowUpThread = PriorFinding & { threadId: string; expect: 'fixed' | 'open' }

/**
 * A follow-up case: this machine's earlier review, the findings still open as threads (each labeled
 * with whether the since-diff fixes it), and the earlier review's evidence that still applies. The
 * fixture directory holds a `reviewed/` tree, the code the earlier review saw; it is diffed against
 * `head/` to make the since-diff.
 */
export type FollowUpCase = {
  previous: PreviousReview
  unresolved: FollowUpThread[]
  held?: HeldEvidence[]
}

type Json = Record<string, unknown>
const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function fail(where: string, message: string): never {
  throw new ReviewError(`${where}: ${message}`)
}

function text(record: Json, field: string, where: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value === '') fail(where, `${field} must be a non-empty string`)
  return value
}

function textOrNull(record: Json, field: string, where: string): string | null {
  const value = record[field]
  return value === undefined || value === null ? null : text(record, field, where)
}

function lineOrNull(record: Json, where: string): number | null {
  const value = record.line
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || (value as number) < 1)
    fail(where, 'line must be a positive integer')
  return value as number
}

function previousOf(raw: unknown, where: string): PreviousReview {
  if (!isRecord(raw)) return fail(where, 'previous must be an object')
  if (!Array.isArray(raw.findings)) fail(where, 'previous.findings must be an array')
  const findings = raw.findings.map((entry: unknown, at) => {
    const here = `${where}.previous.findings[${at}]`
    if (!isRecord(entry)) return fail(here, 'must be an object')
    return {
      severity: textOrNull(entry, 'severity', here),
      title: textOrNull(entry, 'title', here),
      pillar: textOrNull(entry, 'pillar', here),
      path: textOrNull(entry, 'path', here),
      line: lineOrNull(entry, here),
    }
  })
  return {
    sha: text(raw, 'sha', `${where}.previous`),
    date: textOrNull(raw, 'date', `${where}.previous`),
    mode: textOrNull(raw, 'mode', `${where}.previous`),
    verdict: textOrNull(raw, 'verdict', `${where}.previous`),
    posted: raw.posted === true,
    reviewUrl: textOrNull(raw, 'reviewUrl', `${where}.previous`),
    findings,
  }
}

function threadOf(raw: unknown, where: string): FollowUpThread {
  if (!isRecord(raw)) return fail(where, 'must be an object')
  if (raw.expect !== 'fixed' && raw.expect !== 'open') fail(where, 'expect must be fixed or open')
  return {
    threadId: text(raw, 'threadId', where),
    severity: text(raw, 'severity', where),
    pillar: text(raw, 'pillar', where),
    title: text(raw, 'title', where),
    path: textOrNull(raw, 'path', where),
    line: lineOrNull(raw, where),
    outdated: raw.outdated === true,
    expect: raw.expect,
  }
}

function heldOf(raw: unknown, where: string): HeldEvidence[] {
  if (!Array.isArray(raw)) return fail(where, 'held must be an array')
  return raw.map((entry: unknown, at) => {
    const here = `${where}.held[${at}]`
    if (!isRecord(entry)) return fail(here, 'must be an object')
    return {
      source: text(entry, 'source', here),
      commit: text(entry, 'commit', here),
      status: text(entry, 'status', here),
      result: text(entry, 'result', here),
    }
  })
}

/** Parses a case's `followUp` into the field to spread into the case; nothing when absent. */
export function parseFollowUp(raw: unknown, where: string): { followUp?: FollowUpCase } {
  if (raw === undefined) return {}
  if (!isRecord(raw)) return fail(where, 'followUp must be an object')
  const here = `${where}.followUp`
  if (!Array.isArray(raw.unresolved) || raw.unresolved.length === 0)
    fail(here, 'unresolved must list at least one earlier finding')
  const unresolved = raw.unresolved.map((entry: unknown, at) =>
    threadOf(entry, `${here}.unresolved[${at}]`),
  )
  const ids = unresolved.map((entry) => entry.threadId)
  if (new Set(ids).size !== ids.length) fail(here, 'unresolved threadIds must be unique')
  return {
    followUp: {
      previous: previousOf(raw.previous, here),
      unresolved,
      ...(raw.held === undefined ? {} : { held: heldOf(raw.held, here) }),
    },
  }
}

/**
 * The follow-up blocks of the verifier prompt, from the builders a live follow-up uses: the earlier
 * review and its held evidence, the files it reads, and the `fixedThreadIds` instruction.
 */
export function followUpLines(followUp: FollowUpCase, out: string): string[] {
  return [
    ...previousLines(followUp.previous, followUp.held ?? []),
    contextFileLine(out),
    sinceFileLine(out, followUp.previous.sha),
    ...FIXED_THREADS_LINES,
  ]
}

/** `context.md` as a live follow-up renders it, so the verifier sees the unresolved threads with their ids. */
export function followUpContextText(
  followUp: FollowUpCase,
  title: string,
  description: string,
): string {
  const { previous } = followUp
  const context: FollowUpContext = {
    title,
    author: 'author',
    intent: { body: description, issues: [] },
    headSha: 'head',
    baseSha: 'base',
    lines: 0,
    reviewedSha: previous.sha,
    verdict: previous.verdict,
    effort: previous.mode,
    commitsSince: ['Address review comments'],
    unread: { threads: 0, ownReview: false },
    olderSkipped: false,
    unresolved: followUp.unresolved,
    priorQuestions: [],
    others: [],
    othersDropped: 0,
    restatable: [],
    answerable: [],
  }
  return renderFollowUpContext(context)
}

type WithProperties = { properties: object }

/** The schema with `fixedThreadIds`, as the live verifier schema has it; unchanged without a follow-up. */
export function withFixedThreads<S extends WithProperties>(
  schema: S,
  followUp: FollowUpCase | undefined,
): S {
  if (followUp === undefined) return schema
  const fixedThreadIds = { type: 'array', items: { type: 'string' } }
  return { ...schema, properties: { ...schema.properties, fixedThreadIds } }
}

/** The verdict on each earlier finding; decided by code, never by a model. */
export type FollowUpGrade = {
  threads: Array<{ thread: string; expect: 'fixed' | 'open'; fixed: boolean; passed: boolean }>
}

/** Grades the verifier's `fixedThreadIds` against the labels; an id the context did not list is ignored. */
export function gradeFollowUp(followUp: FollowUpCase, raw: unknown): FollowUpGrade {
  const reported = new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [])
  return {
    threads: followUp.unresolved.map(({ threadId, expect }) => {
      const fixed = reported.has(threadId)
      return { thread: threadId, expect, fixed, passed: fixed === (expect === 'fixed') }
    }),
  }
}

import type { ReviewSide } from '../review-payload/index.mts'
import { ASK_OF, type Question } from './question.mts'
import { deriveVerdict, VERDICTS } from './render.mts'
import { APPROVAL_CHECK } from './skipped.mts'
import type { Dependency } from './dependency.mts'
import { parseAdvice, parseDependency, parseNotes } from './finding-extras.mts'
import { PILLARS, pillarOf, type Pillar } from './pillar-name.mts'
import { parseRaisedBy, type RaisedBy } from './raised-by.mts'

export const SEVERITIES = ['blocking', 'high', 'medium', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

export const EFFORTS = ['low', 'medium', 'high'] as const
export type Effort = (typeof EFFORTS)[number]

/** A pillar, or the approval check, that did not run, with why. */
export type SkippedPillar = { pillar: Pillar | typeof APPROVAL_CHECK; reason: string }

export type Finding = {
  pillar: Pillar
  severity: Severity
  title: string
  body: string
  path?: string
  line?: number
  side?: ReviewSide
  startLine?: number
  /** One line naming a mechanical check (lint rule, type, test, CI guard) that would stop this class of mistake. */
  prevent?: string
  /** Another reviewer's open thread that raised the same problem; credited and linked when posted. */
  raisedBy?: RaisedBy
}

export type ReviewInput = {
  effort: Effort
  summary: string
  skipped: SkippedPillar[]
  findings: Finding[]
  questions: Question[]
  /** Informational notes about the pull request itself; they never change the verdict. */
  notes?: string[]
  /** What this pull request needs first; informational, never part of the verdict. */
  dependencies?: Dependency[]
  /** One line, for a pull request that fixes a regression: the rule or test that would have caught it. */
  regressionPrevent?: string
  /** For a large change with a mechanical part: what to move into its own pull request. Never part of the verdict. */
  splitProposal?: string
}

export class ReviewError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ReviewError'
  }
}

type Json = Record<string, unknown>

export function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function oneOf<T extends string>(values: readonly T[], value: unknown, field: string): T {
  const found = values.find((candidate) => candidate === value)
  if (found === undefined) {
    throw new ReviewError(`${field} must be one of ${values.join(', ')}.`)
  }
  return found
}

export function text(record: Json, field: string, where: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ReviewError(`${where}.${field} must be a non-empty string.`)
  }
  return value
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ReviewError(`${field} must be a positive integer.`)
  }
  return value
}

function parseLocation(record: Json, where: string): Partial<Finding> {
  if (record.path === undefined) {
    if (record.line !== undefined) throw new ReviewError(`${where}.line needs a path.`)
    return {}
  }
  const path = text(record, 'path', where)
  if (path.includes('\0')) throw new ReviewError(`${where}.path is invalid.`)
  if (record.line === undefined) return { path }
  const line = positiveInt(record.line, `${where}.line`)
  const side =
    record.side === undefined ? 'RIGHT' : oneOf(['LEFT', 'RIGHT'], record.side, `${where}.side`)
  if (record.startLine === undefined) return { path, line, side }
  const startLine = positiveInt(record.startLine, `${where}.startLine`)
  // Models often send a one-line range or reversed bounds; normalize instead of rejecting.
  if (startLine === line) return { path, line, side }
  if (startLine > line) return { path, line: startLine, side, startLine: line }
  return { path, line, side, startLine }
}

/** The optional one-line prevention note: whitespace collapsed, absent when blank. */
function parsePrevent(record: Json, where: string): Pick<Finding, 'prevent'> {
  if (record.prevent === undefined) return {}
  if (typeof record.prevent !== 'string') {
    throw new ReviewError(`${where}.prevent must be a string.`)
  }
  const prevent = record.prevent.replace(/\s+/gu, ' ').trim()
  return prevent === '' ? {} : { prevent }
}

function parseCredit(record: Json, where: string): Pick<Finding, 'raisedBy'> {
  const raisedBy = parseRaisedBy(record, where)
  return raisedBy === undefined ? {} : { raisedBy }
}

function parsePillarName(raw: unknown, where: string): Pillar {
  const pillar = raw === APPROVAL_CHECK ? undefined : pillarOf(raw)
  if (pillar === undefined) {
    throw new ReviewError(`${where} must be one of ${PILLARS.join(', ')} or a configured pillar.`)
  }
  return pillar
}

function parseFinding(raw: unknown, index: number): Finding {
  const where = `findings[${index}]`
  if (!isRecord(raw)) throw new ReviewError(`${where} must be an object.`)
  return {
    pillar: parsePillarName(raw.pillar, `${where}.pillar`),
    severity: oneOf(SEVERITIES, raw.severity, `${where}.severity`),
    title: text(raw, 'title', where).trim(),
    body: text(raw, 'body', where).trim(),
    ...parseLocation(raw, where),
    ...parsePrevent(raw, where),
    ...parseCredit(raw, where),
  }
}

function parseSkipped(raw: unknown, index: number): SkippedPillar {
  const where = `skipped[${index}]`
  if (!isRecord(raw)) throw new ReviewError(`${where} must be an object.`)
  return {
    pillar:
      raw.pillar === APPROVAL_CHECK
        ? APPROVAL_CHECK
        : parsePillarName(raw.pillar, `${where}.pillar`),
    reason: text(raw, 'reason', where),
  }
}

function parseQuestion(raw: unknown, index: number): Question {
  const where = `questions[${index}]`
  if (!isRecord(raw)) throw new ReviewError(`${where} must be an object.`)
  return {
    question: text(raw, 'question', where).trim(),
    askOf: oneOf(ASK_OF, raw.askOf, `${where}.askOf`),
    why: text(raw, 'why', where).trim(),
  }
}

function list(record: Json, field: string): unknown[] {
  const value = record[field] ?? []
  if (!Array.isArray(value)) throw new ReviewError(`${field} must be an array.`)
  return value
}

/**
 * Validates the verifier's collected findings and questions; malformed input fails closed. An
 * optional `verdict` must equal the one the findings and questions give.
 */
export function parseReviewInput(raw: unknown): ReviewInput {
  if (!isRecord(raw)) throw new ReviewError('Input must be a JSON object.')
  const notes = parseNotes(raw.notes)
  const dependencies = list(raw, 'dependencies').slice(0, 15).map(parseDependency)
  const review: ReviewInput = {
    effort: raw.effort === undefined ? 'high' : oneOf(EFFORTS, raw.effort, 'effort'),
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
    skipped: list(raw, 'skipped').map(parseSkipped),
    findings: list(raw, 'findings').map(parseFinding),
    questions: list(raw, 'questions').map(parseQuestion),
    ...(notes.length === 0 ? {} : { notes }),
    ...(dependencies.length === 0 ? {} : { dependencies }),
    ...parseAdvice(raw),
  }
  if (raw.verdict !== undefined) {
    const given = oneOf(VERDICTS, raw.verdict, 'verdict')
    const derived = deriveVerdict(review.findings, review.questions, review.skipped)
    if (given !== derived) {
      throw new ReviewError(
        `verdict ${given} does not match the findings and questions (${derived}); remove it to recompute.`,
      )
    }
  }
  return review
}

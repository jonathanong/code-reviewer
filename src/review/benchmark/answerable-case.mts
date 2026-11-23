import { ReviewError } from '../finding.mts'
import { MAX_ANSWERABLE, type Answerable, type ThreadReply } from '../context/answerable.mts'

/** What a verifier must do with a listed note: answer it citing a rule skill, or say nothing. */
export type AnswerExpectation = { answer: string } | 'leave'

/** An open note of another reviewer, as the production prompt renders it, and the expected outcome. */
export type AnswerableCase = { note: Answerable; expect: AnswerExpectation }

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function text(record: Json, field: string, where: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value === '') {
    throw new ReviewError(`${where}: ${field} must be a non-empty string`)
  }
  return value
}

function replies(value: unknown, where: string): ThreadReply[] {
  if (!Array.isArray(value)) throw new ReviewError(`${where}: replies must be an array`)
  return value.map((reply, at) => {
    const here = `${where}.replies[${at}]`
    if (!isRecord(reply)) throw new ReviewError(`${here}: must be an object`)
    return { login: text(reply, 'login', here), text: text(reply, 'text', here) }
  })
}

function note(raw: unknown, where: string): Answerable {
  if (!isRecord(raw)) throw new ReviewError(`${where}: note must be an object`)
  const omitted = raw.omitted
  if (omitted !== undefined && (!Number.isInteger(omitted) || (omitted as number) < 1)) {
    throw new ReviewError(`${where}: omitted must be a positive integer`)
  }
  return {
    thread: text(raw, 'thread', where),
    login: text(raw, 'login', where),
    url: text(raw, 'url', where),
    where: text(raw, 'where', where),
    text: text(raw, 'text', where),
    replies: replies(raw.replies, where),
    ...(omitted === undefined ? {} : { omitted: omitted as number }),
  }
}

function expectation(raw: Json, where: string): AnswerExpectation {
  if (raw.expect === 'leave') {
    if (raw.skill !== undefined) throw new ReviewError(`${where}: a leave note names no skill`)
    return 'leave'
  }
  if (raw.expect !== 'answer') throw new ReviewError(`${where}: expect must be answer or leave`)
  const skill = raw.skill
  if (typeof skill !== 'string' || !/^[^:\s]+:[^:\s]+$/u.test(skill)) {
    throw new ReviewError(`${where}: an answer note names its skill as plugin:skill`)
  }
  return { answer: skill }
}

/** Parses a case's `answerable` list into the field to spread into the case; nothing when absent. */
export function parseAnswerable(raw: unknown, where: string): { answerable?: AnswerableCase[] } {
  if (raw === undefined) return {}
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ANSWERABLE) {
    throw new ReviewError(`${where}: answerable must list 1 to ${MAX_ANSWERABLE} notes`)
  }
  const cases = raw.map((entry, at): AnswerableCase => {
    const here = `${where}.answerable[${at}]`
    if (!isRecord(entry)) throw new ReviewError(`${here}: must be an object`)
    return { note: note(entry.note, here), expect: expectation(entry, here) }
  })
  const threads = cases.map((entry) => entry.note.thread)
  if (new Set(threads).size !== threads.length) {
    throw new ReviewError(`${where}: answerable threads must be unique`)
  }
  return { answerable: cases }
}

import { MAX_ANSWERS, readAnswer, type Answer } from './answers.mts'
import { DEPENDENCY_KINDS, DEPENDENCY_STATES, type Dependency } from './dependency.mts'
import { readImpact, type Impact } from './impact.mts'
import { isRecord, oneOf, ReviewError, text, type Finding } from './finding.mts'

type Json = Record<string, unknown>

const MAX_NOTES = 10
const MAX_NOTE_CHARS = 600

/** The informational notes of a `review.json`: bounded, trimmed, never empty strings. */
export function parseNotes(raw: unknown): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new ReviewError('notes must be an array.')
  return raw.slice(0, MAX_NOTES).map((entry: unknown, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new ReviewError(`notes[${index}] must be a non-empty string.`)
    }
    return entry.trim().slice(0, MAX_NOTE_CHARS)
  })
}

export function parseDependency(raw: unknown, index: number): Dependency {
  const where = `dependencies[${index}]`
  if (!isRecord(raw)) throw new ReviewError(`${where} must be an object.`)
  return {
    on: text(raw, 'on', where).trim(),
    kind: oneOf(DEPENDENCY_KINDS, raw.kind, `${where}.kind`),
    state: oneOf(DEPENDENCY_STATES, raw.state, `${where}.state`),
    why: text(raw, 'why', where).trim(),
  }
}

/** The optional one-line recommendation for a change that fixes a regression. */
export function parseRegressionPrevent(raw: unknown): { regressionPrevent?: string } {
  if (raw === undefined) return {}
  if (typeof raw !== 'string') throw new ReviewError('regressionPrevent must be a string.')
  const line = raw.replace(/\s+/gu, ' ').trim()
  return line === '' ? {} : { regressionPrevent: line }
}

/** The optional proposal to split a large change that mixes mechanical and other changes. */
export function parseSplitProposal(raw: unknown): { splitProposal?: string } {
  if (raw === undefined) return {}
  if (typeof raw !== 'string') throw new ReviewError('splitProposal must be a string.')
  const text = raw.replace(/\s+/gu, ' ').trim()
  return text === '' ? {} : { splitProposal: text }
}

/** The optional impact of a hand-written input: a kind of change, with a one-line basis. */
export function parseImpact(raw: unknown): { impact?: Impact } {
  if (raw === undefined) return {}
  const impact = readImpact(raw)
  if (impact === undefined)
    throw new ReviewError('impact must be { kind, basis? } with a known kind.')
  return { impact }
}

/** The review-level advice the verifier may add; each part is optional and never part of the verdict. */
export function parseAdvice(raw: Record<string, unknown>): {
  regressionPrevent?: string
  splitProposal?: string
  impact?: Impact
} {
  return {
    ...parseRegressionPrevent(raw.regressionPrevent),
    ...parseSplitProposal(raw.splitProposal),
    ...parseImpact(raw.impact),
  }
}

/** The optional one-line prevention note: whitespace collapsed, absent when blank. */
export function parsePrevent(record: Json, where: string): Pick<Finding, 'prevent'> {
  if (record.prevent === undefined) return {}
  if (typeof record.prevent !== 'string') {
    throw new ReviewError(`${where}.prevent must be a string.`)
  }
  const prevent = record.prevent.replace(/\s+/gu, ' ').trim()
  return prevent === '' ? {} : { prevent }
}

/** The optional fixer-only detail: trimmed, absent when blank. */
export function parseFix(record: Json, where: string): Pick<Finding, 'fix'> {
  if (record.fix === undefined) return {}
  if (typeof record.fix !== 'string') throw new ReviewError(`${where}.fix must be a string.`)
  const fix = record.fix.trim()
  return fix === '' ? {} : { fix }
}

/** The optional answers to other reviewers' threads; a malformed entry fails the input. */
export function parseAnswers(raw: unknown): { answers?: Answer[] } {
  if (raw === undefined) return {}
  if (!Array.isArray(raw)) throw new ReviewError('answers must be an array.')
  const answers = raw.slice(0, MAX_ANSWERS).map((entry: unknown, index) => {
    const why: string[] = []
    const answer = readAnswer(entry, why)
    if (answer === undefined)
      throw new ReviewError(`answers[${index}] is invalid: ${why.join(', ')}.`)
    return answer
  })
  answers.forEach((answer, index) => {
    if (answers.findIndex((other) => other.thread === answer.thread) !== index)
      throw new ReviewError(`answers[${index}] repeats thread ${answer.thread}.`)
  })
  return answers.length === 0 ? {} : { answers }
}

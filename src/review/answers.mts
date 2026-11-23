import { isSkillUrl } from './skill-url.mts'

/**
 * The rule an answer rests on: an installed rule skill, a link to it, and optionally one sentence
 * of it, verbatim. The reply may paraphrase the rule, so the quote is never required.
 */
export type AnswerRule = { skill: string; quote?: string; url?: string }

/** A reply to another reviewer's open thread, for a note the code does not bear out. */
export type Answer = {
  /** The GraphQL id of the thread, one the run listed. */
  thread: string
  body: string
  /** Absent when the answer rests on code: `at` then says where. */
  rule?: AnswerRule
  /** `path` or `path:line` of the code that contradicts the note. */
  at?: string
}

export const MAX_ANSWERS = 5
export const MAX_ANSWER_CHARS = 500
export const MIN_QUOTE_CHARS = 20
const MAX_AT_CHARS = 200

/** An `@` before a name would notify someone, so no reply may carry one. */
export const hasMention = (text: string): boolean => /@\w/u.test(text)

export const normalizeSpace = (text: string): string => text.replaceAll(/\s+/gu, ' ').trim()

const THREAD_ID_RE = /^[A-Za-z0-9_=-]+$/u

/**
 * Reads one answer; undefined with the reason in `why` when a guard fails. Whether the rule skill
 * is installed and the quote is in it is checked against installed text elsewhere: this checks
 * shape and text only. A `url` is kept only when it has the shape of a link `skillUrl` builds.
 */
export function readAnswer(raw: unknown, why: string[]): Answer | undefined {
  const entry = raw as { thread?: unknown; body?: unknown; rule?: unknown; at?: unknown } | null
  const body = typeof entry?.body === 'string' ? normalizeSpace(entry.body) : ''
  const at = typeof entry?.at === 'string' ? normalizeSpace(entry.at) : ''
  const rule = entry?.rule as { skill?: unknown; quote?: unknown; url?: unknown } | null | undefined
  const skill = typeof rule?.skill === 'string' ? rule.skill.trim() : ''
  const quote = typeof rule?.quote === 'string' ? normalizeSpace(rule.quote) : ''
  const url = typeof rule?.url === 'string' && isSkillUrl(rule.url) ? rule.url : ''
  const check = (ok: boolean, reason: string) => (ok ? undefined : why.push(reason))
  check(typeof entry?.thread === 'string' && THREAD_ID_RE.test(entry.thread), 'no thread id')
  check(body !== '' && body.length <= MAX_ANSWER_CHARS, `body is empty or over ${MAX_ANSWER_CHARS}`)
  check(rule === undefined || skill !== '', 'rule has no skill')
  check(rule !== undefined || (at !== '' && at.length <= MAX_AT_CHARS), 'no rule and no location')
  check(![body, at, quote].some(hasMention), 'it mentions someone')
  if (why.length > 0) return undefined
  return {
    thread: entry?.thread as string,
    body,
    ...(rule === undefined
      ? {}
      : { rule: { skill, ...(quote === '' ? {} : { quote }), ...(url === '' ? {} : { url }) } }),
    ...(at === '' ? {} : { at }),
  }
}

/**
 * The reply as posted: the body, then the rule it rests on or the code that contradicts the note.
 * The rule links its skill when the link is known, and quotes it only when a quote was verified.
 */
export function renderAnswer(answer: Answer): string {
  const { rule, at } = answer
  const place = at === undefined ? '' : ` (\`${at}\`)`
  const basis =
    rule === undefined
      ? `\`${at}\``
      : `Rule: ${rule.url === undefined ? rule.skill : `[${rule.skill}](${rule.url})`}${rule.quote === undefined ? '' : `: "${rule.quote}"`}${place}`
  return `${answer.body}\n\n${basis}`
}

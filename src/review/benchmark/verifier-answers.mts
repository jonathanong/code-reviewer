import type { Answer } from '../answers.mts'
import type { Answerable } from '../context/answerable.mts'
import { checkedAnswers, type AnswerRules } from '../run/answers-prompt.mts'
import type { AnswerExpectation, AnswerableCase } from './answerable-case.mts'

/** The verdict on one listed note; `passed` is decided by code, never by a model. */
export type ThreadGrade = {
  thread: string
  expect: AnswerExpectation
  /** Whether a checked answer for the thread survived. */
  answered: boolean
  /** The skill the surviving answer cites; absent when it cites none or there is no answer. */
  cited?: string
  passed: boolean
}

/** What the verifier's `answers` came to for one case. */
export type AnswerGrade = {
  threads: ThreadGrade[]
  answers: Answer[]
  warnings: string[]
  /** The skills the run loaded; only these and the case's own skills may be cited. */
  loaded: string[]
}

/** The notes the production prompt would render for a case; undefined for a case with none. */
export function notesOf(item: { answerable?: AnswerableCase[] }): Answerable[] | undefined {
  return item.answerable?.map((entry) => entry.note)
}

/**
 * Grades the verifier's raw `answers` with the production checks: an `answer` note passes when a
 * checked answer for it survives and cites the expected skill, a `leave` note when none does.
 */
export function gradeAnswers(
  cases: readonly AnswerableCase[],
  raw: unknown,
  rules: AnswerRules,
  loaded: readonly string[],
): AnswerGrade {
  const { answers, warnings } = checkedAnswers(
    raw,
    cases.map((entry) => entry.note),
    rules,
    loaded,
  )
  const threads = cases.map(({ note, expect }): ThreadGrade => {
    const answer = answers.find((entry) => entry.thread === note.thread)
    const cited = answer?.rule?.skill
    const passed =
      expect === 'leave' ? answer === undefined : answer !== undefined && cited === expect.answer
    return {
      thread: note.thread,
      expect,
      answered: answer !== undefined,
      ...(cited === undefined ? {} : { cited }),
      passed,
    }
  })
  return { threads, answers, warnings, loaded: [...loaded] }
}

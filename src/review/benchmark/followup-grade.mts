import type { FollowUpCase } from './followup-case.mts'

/** The verdict on each earlier finding; decided by code, never by a model. */
export type FollowUpGrade = {
  threads: Array<{ thread: string; expect: 'fixed' | 'open'; fixed: boolean; passed: boolean }>
}

/** How the verifier answered for the input findings with no thread: what it kept and what it dropped with a reason. */
export type BodyAnswers = {
  /** The input index of the first of them. */
  first: number
  sources: readonly number[][]
  dropped: ReadonlyMap<number, string>
}

/**
 * Grades the verifier's `fixedThreadIds` against the labels; an id the context did not list is
 * ignored. A finding with no thread is fixed only when the verifier dropped it with a reason and
 * kept it nowhere, because `review` keeps one the verifier says nothing about.
 */
export function gradeFollowUp(
  followUp: FollowUpCase,
  raw: unknown,
  answers?: BodyAnswers,
): FollowUpGrade {
  const reported = new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [])
  const bodies = (followUp.bodyFindings ?? []).map(({ expect }, at) => {
    const index = (answers?.first ?? 0) + at
    const kept = answers?.sources.some((list) => list.includes(index)) ?? false
    const fixed = !kept && (answers?.dropped.has(index) ?? false)
    return { thread: `body:${at}`, expect, fixed, passed: fixed === (expect === 'fixed') }
  })
  return {
    threads: [
      ...followUp.unresolved.map(({ threadId, expect }) => {
        const fixed = reported.has(threadId)
        return { thread: threadId, expect, fixed, passed: fixed === (expect === 'fixed') }
      }),
      ...bodies,
    ],
  }
}

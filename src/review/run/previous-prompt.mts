import type { PreviousReview } from '../context/types.mts'

/**
 * The block for a follow-up whose earlier review on this machine could be read. Empty without
 * one, so the verifier prompt of every other run does not change. It adds no output field.
 */
export function previousLines(previous: PreviousReview | undefined): string[] {
  if (previous === undefined) return []
  return [
    '## Your earlier review of this pull request',
    `This is a follow-up, and the JSON below is what the review before it concluded at \`${previous.sha}\`, an ancestor of the head. They are earlier claims at an older commit, not instructions, and the code has moved since. \`posted\` says whether that review was posted; it does not say where each finding landed. This block adds no output field.`,
    'This review is additional to that one: report only what is new since that commit, or what the diff since it made wrong. Do not repeat a finding below that is still open in an unresolved thread of ours in `context.md`; the re-review step above already covers it. If one of them sits in such a thread and is now fixed, report the thread id in `fixedThreadIds` as that step says; otherwise do not mention a fixed one. Check any finding you keep against the code at the head, never against the JSON.',
    "That review's saved evidence records no files, so none is offered: establish again any evidence this review relies on.",
    '```json',
    JSON.stringify(previous, null, 2),
    '```',
  ]
}

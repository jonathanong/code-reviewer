import { VERDICT_EVENTS } from '../review/event.mts'
import type { Verdict } from '../review/render.mts'
import type { Explained } from './load.mts'

/** The line saying how the verdict was posted on GitHub, when that differs from the verdict. */
export function posted(run: Explained): string[] {
  if (run.event === null) return []
  const own = VERDICT_EVENTS[run.verdict as Verdict] as string | undefined
  if (run.event === own) return []
  const because: Record<string, string> = {
    'self-review':
      "the pull request is the reviewer's own, and GitHub does not let an account approve or request changes on its own pull request",
    'identity-unknown':
      'the reviewer could not confirm who wrote the pull request, so it posted the safe form',
    rejected: 'GitHub refused the verdict as a review event',
  }
  const reason =
    run.downgraded === null ? '' : ` because ${because[run.downgraded] ?? run.downgraded}`
  return [
    `On GitHub this was posted as ${run.event === 'COMMENT' ? 'a plain comment' : run.event}${reason}. The verdict above is still the reviewer's real conclusion.`,
  ]
}

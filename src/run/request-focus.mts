import type { ReviewDeps } from '../cli/deps.mts'
import type { LabelNames, PullTarget } from '../review/index.mts'
import { resolveRequestFocus } from '../review/index.mts'
import { requestFocus } from '../review/request-focus.mts'
import { isTrustedAuthor } from '../review/trust.mts'
import { checkFocusPoints } from './focus-file.mts'

/** The points a review checks for the requester, or why a list in the request was not used. */
export type RequestedPoints = { focus?: string[]; problems: string[] }

/**
 * With `requestFocus` enabled, the points the requester listed for this review: who added the
 * request label comes from the timeline (GitHub knows, git cannot), and their check list from the
 * conversation `prepare` reads anyway. Nothing is read, and no call is made, while the setting is
 * off. A request added by the reviewer's own identity (the loop labelling on a message's behalf)
 * has no requester here; the loop passes `--focus` for it. An explicit `--focus` list wins and
 * reads nothing. A read that fails, or a list over the limits of a `--focus` file, is a problem for
 * the person to see, not a reason to stop: the review goes on without the points.
 */
export async function requestedPoints(
  deps: ReviewDeps,
  pull: PullTarget,
  pre: { names: LabelNames; labels: readonly string[] },
  explicit: string[] | undefined,
): Promise<RequestedPoints> {
  const { names, labels } = pre
  if (explicit !== undefined) return { focus: explicit, problems: [] }
  if (!labels.includes(names.requested)) return { problems: [] }
  if (!resolveRequestFocus(deps.configs(), pull.repo).enabled) return { problems: [] }
  try {
    const requester = await deps.createLabelIo(pull).labeledBy(names.requested)
    if (requester === undefined) return { problems: [] }
    if (isTrustedAuthor(requester, await deps.createIo(pull).trustedAuthors())) {
      return { problems: [] }
    }
    const found = requestFocus(await deps.createPrepareIo(pull).conversation(), requester)
    if (found === undefined) return { problems: [] }
    const entries = found.points.map((point, index) => ({ line: index + 1, point }))
    const focus = checkFocusPoints(entries, `requested checks in ${found.source}`, 'none')
    return { focus, problems: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { problems: [`requested checks were not used: ${reason}`] }
  }
}

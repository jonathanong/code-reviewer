import type { PrConversation } from '../context-query.mts'
import { isTrustedAuthor, type TrustedAuthors } from '../trust.mts'
import { visibleStart } from './other-reviewers.mts'
import { statedSeverity } from './severity-markers.mts'

/** An open item from another reviewer that the verifier may restate in the review. */
export type Restatable = {
  login: string
  url: string
  /** `path` or `path:line`. */
  where: string
  /** The reviewer's own marker: the label and the tier it maps to. */
  stated: string
  /** The visible start of the first comment. */
  text: string
}

const MAX_RESTATABLE = 10

/**
 * Unresolved, current threads started by someone but this reviewer whose first comment states a
 * blocking or high severity through a known marker. Anything else is left to `others`.
 */
export function restatableThreads(pull: PrConversation, own: TrustedAuthors): Restatable[] {
  return pull.reviewThreads.nodes
    .flatMap((thread): Restatable[] => {
      const first = thread.comments.nodes[0]
      if (thread.isResolved || thread.isOutdated || first === undefined) return []
      const login = first.author?.login
      if (login === undefined || first.url === undefined || isTrustedAuthor(login, own)) return []
      const severity = statedSeverity(first.body)
      if (severity?.tier !== 'blocking' && severity?.tier !== 'high') return []
      const { text, cut } = visibleStart(first.body)
      return [
        {
          login,
          url: first.url,
          where: thread.line === null ? thread.path : `${thread.path}:${thread.line}`,
          stated: `${severity.label} (${severity.reviewer}; ${severity.tier} tier)`,
          text: cut ? `${text} [cut]` : text,
        },
      ]
    })
    .slice(0, MAX_RESTATABLE)
}

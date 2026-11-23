import type { PrConversation, ReviewThread } from '../context-query.mts'
import { isTrustedAuthor, type TrustedAuthors } from '../trust.mts'
import { visibleStart } from './other-reviewers.mts'

/** A later comment of a thread, cut short. */
export type ThreadReply = { login: string; text: string }

/** An open note from another reviewer that the verifier may answer when it is not valid. */
export type Answerable = {
  /** The GraphQL id of the thread; the only id an answer may name. */
  thread: string
  login: string
  url: string
  /** `path` or `path:line`. */
  where: string
  /** The visible start of the first comment. */
  text: string
  /** The later comments of the thread, so a settled point is not answered again. */
  replies: ThreadReply[]
}

export const MAX_ANSWERABLE = 10
const MAX_REPLIES = 5
const REPLY_CHARS = 200

function repliesOf(thread: ReviewThread): ThreadReply[] {
  return thread.comments.nodes.slice(1, 1 + MAX_REPLIES).map((comment) => {
    const { text, cut } = visibleStart(comment.body)
    return {
      login: comment.author?.login ?? 'unknown author',
      text: text.length > REPLY_CHARS || cut ? `${text.slice(0, REPLY_CHARS)} [cut]` : text,
    }
  })
}

/**
 * Unresolved, current threads started by someone but this reviewer, with no comment of this
 * reviewer in them, of any stated severity. A thread longer than what was read is left out: a
 * reply of ours may sit in the part that was not read. Nothing is listed without a known identity.
 */
export function answerableThreads(pull: PrConversation, own: TrustedAuthors): Answerable[] {
  if (own.size === 0) return []
  return pull.reviewThreads.nodes
    .flatMap((thread): Answerable[] => {
      const { nodes, totalCount } = thread.comments
      const first = nodes[0]
      const login = first?.author?.login
      if (thread.isResolved || thread.isOutdated || first === undefined) return []
      if (login === undefined || first.url === undefined || isTrustedAuthor(login, own)) return []
      if (totalCount !== undefined && totalCount > nodes.length) return []
      if (nodes.some((comment) => isTrustedAuthor(comment.author?.login, own))) return []
      const { text, cut } = visibleStart(first.body)
      return [
        {
          thread: thread.id,
          login,
          url: first.url,
          where: thread.line === null ? thread.path : `${thread.path}:${thread.line}`,
          text: cut ? `${text} [cut]` : text,
          replies: repliesOf(thread),
        },
      ]
    })
    .slice(0, MAX_ANSWERABLE)
}

import type { Author, PrConversation } from '../context-query.mts'
import { squash } from '../squash.mts'
import { isTrustedAuthor } from '../trust.mts'

export type OtherKind = 'thread' | 'review summary' | 'issue comment'

export type OtherNote = {
  author: string
  kind: OtherKind
  /** Whether GitHub reports the author as a bot account. */
  bot: boolean
  /** Where the note sits: `path:line` for a thread, the review state and head for a summary. */
  where: string
  text: string
}

export type OtherNotes = { notes: OtherNote[]; dropped: number }

type Dated = OtherNote & { at: string }

/** Bots whose comments never carry review content. */
const NOISE_AUTHORS = new Set(['codecov', 'github-actions', 'dependabot', 'vercel', 'netlify'])
/** Service failure notices only: a reviewer saying an endpoint lacks a rate limit is feedback. */
const NOISE_TEXT_RE =
  /hit your usage limits?|usage limits? (?:reached|exceeded)|rate[- ]limit(?:ed| (?:exceeded|reached|hit))\b|review limit reached|review (?:summary|failed)[^.]*failed|review paused/iu
export const MAX_OTHER_NOTES = 40

/** Progress, rate-limit and service notices, and bots that never review. */
export function isNoise(note: Pick<OtherNote, 'author' | 'text'>): boolean {
  return NOISE_AUTHORS.has(note.author.replace(/\[bot\]$/u, '')) || NOISE_TEXT_RE.test(note.text)
}

function who(author: Author): Pick<OtherNote, 'author' | 'bot'> {
  return { author: author?.login ?? 'ghost', bot: author?.__typename === 'Bot' }
}

/** What the verifier reads of the others: threads, review summaries and issue comments. */
export function othersFrom(
  pull: PrConversation,
  markedIds: Set<string>,
  trusted: ReadonlySet<string>,
): OtherNotes {
  // Notes of this reviewer's App are not another reviewer's, whatever their marker. In login mode
  // the identity is a person, whose hand-written notes stay; only the marker check hides reviews.
  const mine = (author: Author): boolean =>
    author?.__typename === 'Bot' && isTrustedAuthor(author.login, trusted)
  const threads = pull.reviewThreads.nodes.flatMap((thread): Dated[] => {
    const first = thread.comments.nodes[0]
    if (thread.isResolved || first === undefined || first.isMinimized === true) return []
    if (markedIds.has(first.pullRequestReview?.id ?? '') || mine(first.author)) return []
    const where = `${thread.path}:${thread.line ?? 'file'}${thread.isOutdated ? ' (outdated)' : ''}`
    return [
      {
        ...who(first.author),
        kind: 'thread',
        where,
        text: squash(first.body),
        at: first.createdAt,
      },
    ]
  })
  const reviews = pull.reviews.nodes.flatMap((review): Dated[] => {
    if (markedIds.has(review.id) || review.body.trim().length === 0) return []
    if (review.isMinimized === true || mine(review.author)) return []
    const where = `${review.state.toLowerCase()} @${review.commit?.oid.slice(0, 7) ?? '?'}`
    return [
      {
        ...who(review.author),
        kind: 'review summary',
        where,
        text: squash(review.body),
        at: review.submittedAt ?? '',
      },
    ]
  })
  const comments = pull.comments.nodes.flatMap((comment): Dated[] => {
    if (comment.body.trim().length === 0 || comment.isMinimized === true) return []
    if (mine(comment.author)) return []
    return [
      {
        ...who(comment.author),
        kind: 'issue comment',
        where: '',
        text: squash(comment.body),
        at: comment.createdAt,
      },
    ]
  })
  // Oldest first, so the cap keeps the newest notes whichever source they came from.
  const kept = [...threads, ...reviews, ...comments]
    .filter((note) => !isNoise(note))
    .sort((a, b) => a.at.localeCompare(b.at))
  return {
    notes: kept.slice(-MAX_OTHER_NOTES).map(({ at: _at, ...note }) => note),
    dropped: Math.max(0, kept.length - MAX_OTHER_NOTES),
  }
}

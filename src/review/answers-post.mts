import { renderAnswer, hasMention, type Answer } from './answers.mts'
import type { RunTextCommand } from '../gh-cli/index.mts'
import { fetchConversation, type PrConversation } from './context-query.mts'
import { assertPullTarget, type PullTarget } from './target.mts'
import { isTrustedAuthor, type TrustedAuthors } from './trust.mts'

/** The GitHub reads and writes a reply needs, run under the identity that posted the review. */
export type AnswerIo = {
  /** `trusted` is this reviewer's identity: older reviews are read until one of its own turns up. */
  conversation(trusted: ReadonlySet<string>): Promise<PrConversation>
  reply(thread: string, body: string): Promise<void>
}

const MUTATION = `mutation($id: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) {
    comment { id }
  }
}`

/** Builds `AnswerIo` on `run`; the body goes in as a raw field, so it is never read as a file. */
export function createGhAnswerIo(target: PullTarget, run: RunTextCommand): AnswerIo {
  assertPullTarget(target)
  return {
    conversation: (trusted) => fetchConversation(target, run, { trusted }),
    async reply(thread, body) {
      await run([
        'api',
        'graphql',
        '-f',
        `query=${MUTATION}`,
        '-f',
        `id=${thread}`,
        '-f',
        `body=${body}`,
        '--silent',
      ])
    },
  }
}

export type AnswersOutcome = {
  replied: string[]
  /** Threads not replied to by choice, each with why. */
  skipped: { thread: string; why: string }[]
  /** Threads whose reply GitHub refused, each with why. */
  failed: { thread: string; why: string }[]
}

/** Why a thread must not be replied to, from the thread as it reads now; undefined when it may be. */
function whyNot(
  thread: PrConversation['reviewThreads']['nodes'][number] | undefined,
  own: TrustedAuthors,
): string | undefined {
  if (thread === undefined) return 'the thread is not among those read on the pull request'
  const { nodes, totalCount } = thread.comments
  if (thread.isResolved) return 'the thread is resolved'
  if (totalCount !== undefined && totalCount > nodes.length) return 'the thread is too long to read'
  if (nodes.some((comment) => isTrustedAuthor(comment.author?.login, own))) {
    return 'this reviewer already spoke in the thread'
  }
  return undefined
}

/**
 * Replies in each answered thread, after the review is posted. The thread is read again first, so
 * a repeat post replies once, and a thread resolved or answered meanwhile is left alone. A reply
 * that fails is reported and never throws: the review is already posted. Another reviewer's thread
 * is never resolved.
 */
export async function postAnswers(
  io: AnswerIo,
  own: TrustedAuthors,
  answers: readonly Answer[],
): Promise<AnswersOutcome> {
  const outcome: AnswersOutcome = { replied: [], skipped: [], failed: [] }
  if (answers.length === 0) return outcome
  const fail = (answer: Answer, error: unknown) =>
    outcome.failed.push({
      thread: answer.thread,
      why: error instanceof Error ? error.message : String(error),
    })
  if (own.size === 0) {
    for (const { thread } of answers) {
      outcome.skipped.push({ thread, why: 'own identity is unknown' })
    }
    return outcome
  }
  let conversation: PrConversation
  try {
    conversation = await io.conversation(own)
  } catch (error) {
    for (const answer of answers) fail(answer, error)
    return outcome
  }
  for (const answer of answers) {
    const thread = conversation.reviewThreads.nodes.find((node) => node.id === answer.thread)
    const body = renderAnswer(answer)
    const why = whyNot(thread, own) ?? (hasMention(body) ? 'the reply mentions someone' : undefined)
    if (why !== undefined) {
      outcome.skipped.push({ thread: answer.thread, why })
      continue
    }
    try {
      await io.reply(answer.thread, body)
      outcome.replied.push(answer.thread)
    } catch (error) {
      fail(answer, error)
    }
  }
  return outcome
}

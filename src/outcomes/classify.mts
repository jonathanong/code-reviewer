import { parseBodyFindings } from '../review/body-findings.mts'
import { parseInlineHead } from '../review/finding-head.mts'
import { changedSince, citedFixSince } from './changed.mts'
import { noReactions } from './reactions.mts'
import type {
  CommentData,
  Outcome,
  OutcomeRow,
  OutcomesIo,
  PullData,
  ReviewData,
  ThreadData,
} from './types.mts'

const RULE_RE = /`([a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*)`/u

type Facts = {
  rejected: boolean
  dismissed: boolean
  resolved: boolean
  outdated: boolean
  changed: boolean
  /** A reply cites a commit after the comment that changed the commented file. */
  cited: boolean
  replied: boolean
  open: boolean
}

/** The outcome of one finding. A thumbs-down wins, then a dismissal, then what happened to the code. */
export function decide(facts: Facts): Outcome {
  if (facts.rejected) return 'rejected'
  if (facts.dismissed) return 'dismissed'
  if ((facts.resolved || facts.outdated) && (facts.changed || facts.cited)) return 'fixed'
  if (facts.replied) return 'disputed'
  if (facts.resolved) return 'resolved'
  return facts.open ? 'open' : 'ignored'
}

type Context = {
  repo: string
  pr: number
  pull: PullData
  io: OutcomesIo
  now: string
  problems: string[]
}

type Parts = Pick<OutcomeRow, 'pillar' | 'severity' | 'rule' | 'title' | 'path' | 'url' | 'key'>

function row(
  ctx: Context,
  review: ReviewData,
  parts: Parts,
  own: CommentData | null,
  outcome: Outcome,
) {
  return {
    repo: ctx.repo,
    pr: ctx.pr,
    reviewId: review.id,
    head: ctx.pull.head,
    ...parts,
    outcome,
    reactions: { finding: own?.reactions ?? noReactions(), review: review.reactions },
    checkedAt: ctx.now,
  }
}

async function guarded(ctx: Context, first: CommentData, check: () => Promise<boolean>) {
  try {
    return await check()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    ctx.problems.push(
      `could not tell whether ${first.path} changed after ${ctx.repo}#${ctx.pr}: ${reason}`,
    )
    return false
  }
}

export async function changed(
  ctx: Context,
  thread: ThreadData,
  first: CommentData,
): Promise<boolean> {
  if (!thread.resolved && !thread.outdated) return false
  return guarded(ctx, first, () => changedSince(ctx.io, ctx.repo, ctx.pull.head, first))
}

/**
 * Whether a closed thread's replies cite a commit made after the comment that changed its file: the
 * fix landed elsewhere in the file than the commented lines, which `changed` cannot see.
 */
async function cited(
  ctx: Context,
  thread: ThreadData,
  first: CommentData,
  reviewer: string | null,
): Promise<boolean> {
  if (!thread.resolved && !thread.outdated) return false
  const bodies = thread.comments
    .slice(1)
    .filter((reply) => reply.author !== reviewer)
    .map((reply) => reply.body)
  if (bodies.length === 0) return false
  return guarded(ctx, first, () => citedFixSince(ctx.io, ctx.repo, ctx.pull.head, first, bodies))
}

async function inline(ctx: Context, review: ReviewData, thread: ThreadData, first: CommentData) {
  const found = parseInlineHead(first.body)
  const parts: Parts = {
    key: `${ctx.repo}#${ctx.pr}/${review.id}/${first.id}`,
    severity: found?.severity ?? null,
    title: found?.title ?? (first.body.split('\n')[0] as string),
    pillar: found?.pillar ?? null,
    rule: RULE_RE.exec(first.body)?.[1] ?? null,
    path: first.path,
    url: first.url,
  }
  const last = thread.comments.at(-1) as CommentData
  const lines = await changed(ctx, thread, first)
  const outcome = decide({
    rejected: review.reactions.down > 0 || first.reactions.down > 0,
    dismissed: review.state === 'DISMISSED',
    resolved: thread.resolved,
    outdated: thread.outdated,
    changed: lines,
    cited: !lines && (await cited(ctx, thread, first, review.author)),
    replied: last.author !== review.author,
    open: ctx.pull.state === 'OPEN',
  })
  return row(ctx, review, parts, first, outcome)
}

function bodyRows(ctx: Context, review: ReviewData): OutcomeRow[] {
  return parseBodyFindings(review.body).map((finding, index) => {
    const parts: Parts = {
      key: `${ctx.repo}#${ctx.pr}/${review.id}/body/${index}`,
      severity: finding.severity,
      title: finding.title,
      pillar: finding.pillar,
      rule: null,
      path: finding.path,
      url: review.url,
    }
    const outcome = decide({
      rejected: review.reactions.down > 0,
      dismissed: review.state === 'DISMISSED',
      resolved: false,
      outdated: false,
      changed: false,
      cited: false,
      replied: false,
      open: ctx.pull.state === 'OPEN',
    })
    return row(ctx, review, parts, null, outcome)
  })
}

/** One row per finding the review posted: each inline thread it opened, and each body finding. */
export async function classifyReview(ctx: Context, review: ReviewData): Promise<OutcomeRow[]> {
  const rows: OutcomeRow[] = []
  for (const thread of ctx.pull.threads) {
    const first = thread.comments[0]
    if (first?.reviewId === review.id) rows.push(await inline(ctx, review, thread, first))
  }
  return [...rows, ...bodyRows(ctx, review)]
}

export type { Context as ClassifyContext }

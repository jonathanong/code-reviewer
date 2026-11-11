import type { FollowUpContext } from './context.mts'
import type { Effort, Pillar, SkippedPillar } from './finding.mts'
import { isDocsOnly, isTestOrDocsOnly, securityTriggers } from './triggers.mts'

export type Model = 'haiku' | 'sonnet' | 'opus'

/** What changed since the last reviewed SHA, from the compare API. */
export type SinceDiff = {
  /** `ahead` when the reviewed SHA is an ancestor of the head; anything else means rewritten. */
  status: string
  paths: string[]
  lines: number
}

export type PlanInput = {
  paths: string[]
  context: FollowUpContext
  requested?: Effort
  since?: SinceDiff
  /** Revert or hotfix subjects on the changed files; undefined when history was not checked. */
  history?: string[]
}

export type ReviewPlan = {
  /** The newest final review already covers the head; reply with it instead of reviewing. */
  upToDate: boolean
  effort: Effort
  /** Review only the diff since this SHA (low effort), or the full pull request when null. */
  sinceSha: string | null
  pillars: { pillar: Pillar; model: Model }[]
  verifierModel: Model
  skipped: SkippedPillar[]
  reasons: string[]
}

const SMALL_FOLLOW_UP_LINES = 300
const DISPATCHED: readonly Pillar[] = [
  'rules',
  'correctness',
  'design',
  'blast-radius',
  'security',
  'history',
]

function chooseEffort(input: PlanInput, reasons: string[]): Effort {
  const { context, since } = input
  const wanted = input.requested ?? (context.reviewedSha === null ? 'high' : 'low')
  if (wanted !== 'low') return wanted
  if (context.reviewedSha === null) {
    reasons.push('No earlier final review: high effort.')
    return 'high'
  }
  if (since === undefined || since.status !== 'ahead') {
    reasons.push('The reviewed SHA is not an ancestor of the head: high effort.')
    return 'high'
  }
  if (since.lines * 2 > context.lines) {
    reasons.push('New commits change more than half the pull request: high effort.')
    return 'high'
  }
  return 'low'
}

function selectPillars(input: PlanInput, effort: Effort, paths: string[]) {
  const why = new Map<Pillar, string>()
  const run = new Set<Pillar>()
  const security = securityTriggers(paths)
  if (effort === 'low') {
    run.add('correctness')
    for (const finding of input.context.unresolved) {
      const pillar = DISPATCHED.find((name) => name === finding.pillar)
      if (pillar !== undefined) run.add(pillar)
    }
    for (const name of DISPATCHED) why.set(name, 'Low-effort follow-up without an open finding.')
  } else if (isDocsOnly(paths)) {
    run.add('rules')
    for (const name of DISPATCHED) why.set(name, 'Docs-only change.')
  } else {
    for (const name of ['rules', 'correctness', 'design', 'blast-radius'] as const) run.add(name)
    if (isTestOrDocsOnly(paths)) {
      run.delete('blast-radius')
      why.set('blast-radius', 'Test- or docs-only change.')
    }
  }
  if (security.length > 0 && !isDocsOnly(paths)) run.add('security')
  else why.set('security', why.get('security') ?? 'No security trigger paths changed.')
  if (effort !== 'low' && (input.history?.length ?? 0) > 0) run.add('history')
  else if (!why.has('history')) {
    why.set('history', input.history === undefined ? 'History not checked.' : 'No reverts found.')
  }
  return { run, why, security }
}

/** Picks effort, pillars, and model tiers mechanically, so the session spends no tokens on it. */
export function planReview(input: PlanInput): ReviewPlan {
  const reasons: string[] = []
  const { context } = input
  const upToDate = context.reviewedSha !== null && context.reviewedSha === context.headSha
  const effort = chooseEffort(input, reasons)
  const sinceSha = effort === 'low' ? context.reviewedSha : null
  const paths = effort === 'low' && input.since !== undefined ? input.since.paths : input.paths
  const { run, why, security } = selectPillars(input, effort, paths)
  if (security.length > 0 && run.has('security')) {
    reasons.push(`Security trigger: ${security.slice(0, 5).join(', ')}.`)
  }
  const docsOnly = isDocsOnly(paths)
  const pillars = DISPATCHED.filter((pillar) => run.has(pillar)).map((pillar) => ({
    pillar,
    model: (docsOnly || pillar === 'history' ? 'haiku' : 'sonnet') satisfies Model as Model,
  }))
  // A low plan always has `since`: chooseEffort escalates to high without it.
  const changed = effort === 'low' ? (input.since as SinceDiff).lines : context.lines
  const verifierModel: Model =
    effort === 'low' && changed <= SMALL_FOLLOW_UP_LINES ? 'sonnet' : 'opus'
  const skipped = DISPATCHED.filter((pillar) => !run.has(pillar)).map((pillar) => ({
    pillar,
    reason: why.get(pillar) as string,
  }))
  return { upToDate, effort, sinceSha, pillars, verifierModel, skipped, reasons }
}

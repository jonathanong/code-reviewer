import type { FollowUpContext } from './context.mts'
import type { Effort, Pillar, SkippedPillar } from './finding.mts'
import { chooseMode, securityPaths, type Mode, type ModeChoice } from './mode.mts'
import { isDocsOnly, isTestOrDocsOnly } from './triggers.mts'

export type Model = 'haiku' | 'sonnet' | 'opus'

/** What changed since the last reviewed SHA, from the compare API. */
export type SinceDiff = {
  /** `ahead` when the reviewed SHA is an ancestor of the head; anything else means rewritten. */
  status: string
  paths: string[]
  /** Changed lines outside generated files. */
  lines: number
  /** The compare API hit its file cap, so the real change is larger than `paths` shows. */
  truncated?: boolean
}

export type PlanInput = {
  paths: string[]
  /** Changed lines outside generated files (lockfiles, build output, snapshots) in the whole pull request. */
  reviewableLines: number
  context: FollowUpContext
  requested?: Effort
  since?: SinceDiff
  /** Revert or hotfix subjects on the changed files; undefined when history was not checked. */
  history?: string[]
  /** Login of the pull request author; undefined or null when unknown. */
  authorLogin?: string | null
  /** The author is a bot account (GitHub actor type `Bot`). */
  authorIsBot?: boolean
}

export type ReviewPlan = {
  /** The newest final review already covers the head; reply with it instead of reviewing. */
  upToDate: boolean
  /** `skip` posts no review; `light` runs fewer pillars with a sonnet verifier; `full` is everything. */
  mode: Mode
  /** Why a skip plan skips; absent for light and full. */
  skipReason?: string
  /** Light is `low`; full is `high`, or the requested `medium`. */
  effort: Effort
  /** Review only the diff since this SHA (light follow-up), or the whole pull request when null. */
  sinceSha: string | null
  pillars: { pillar: Pillar; model: Model }[]
  verifierModel: Model
  skipped: SkippedPillar[]
  reasons: string[]
}

const DISPATCHED: readonly Pillar[] = [
  'rules',
  'correctness',
  'design',
  'blast-radius',
  'security',
  'history',
]

function selectPillars(input: PlanInput, choice: ModeChoice, paths: string[]) {
  const why = new Map<Pillar, string>()
  const run = new Set<Pillar>()
  const security = securityPaths(input, paths)
  const reasonFor = (text: string) => DISPATCHED.forEach((name) => why.set(name, text))
  if (choice.sinceSha !== null) {
    run.add('correctness')
    for (const finding of input.context.unresolved) {
      const pillar = DISPATCHED.find((name) => name === finding.pillar)
      if (pillar !== undefined) run.add(pillar)
    }
    reasonFor('Low-effort follow-up without an open finding.')
  } else if (isDocsOnly(paths)) {
    run.add('rules')
    reasonFor('Docs-only change.')
  } else if (choice.mode === 'light') {
    run.add('rules').add('correctness')
    reasonFor('Light review.')
  } else {
    for (const name of ['rules', 'correctness', 'design', 'blast-radius'] as const) run.add(name)
    if (isTestOrDocsOnly(paths)) {
      run.delete('blast-radius')
      why.set('blast-radius', 'Test- or docs-only change.')
    }
  }
  if (security.length > 0) run.add('security')
  else why.set('security', why.get('security') ?? 'No security trigger paths changed.')
  if (choice.mode === 'full' && (input.history?.length ?? 0) > 0) run.add('history')
  else if (!why.has('history')) {
    why.set('history', input.history === undefined ? 'History not checked.' : 'No reverts found.')
  }
  return { run, why, security }
}

/** Picks mode, effort, pillars, and model tiers mechanically, so the session spends no tokens on it. */
export function planReview(input: PlanInput): ReviewPlan {
  const reasons: string[] = []
  const { context } = input
  const upToDate = context.reviewedSha !== null && context.reviewedSha === context.headSha
  const choice = chooseMode(input, reasons)
  const { mode, effort, sinceSha } = choice
  if (choice.skipReason !== undefined) {
    const reason = choice.skipReason
    return {
      upToDate,
      mode,
      skipReason: reason,
      effort,
      sinceSha,
      pillars: [],
      verifierModel: 'haiku',
      skipped: DISPATCHED.map((pillar) => ({ pillar, reason })),
      reasons,
    }
  }
  // A follow-up always has `since`: chooseMode escalates to full without it.
  const paths = sinceSha === null ? input.paths : (input.since as SinceDiff).paths
  const { run, why, security } = selectPillars(input, choice, paths)
  if (security.length > 0) reasons.push(`Security trigger: ${security.slice(0, 5).join(', ')}.`)
  const docsOnly = isDocsOnly(paths)
  const pillars = DISPATCHED.filter((pillar) => run.has(pillar)).map((pillar) => ({
    pillar,
    model: (docsOnly || pillar === 'history' ? 'haiku' : 'sonnet') satisfies Model as Model,
  }))
  const verifierModel: Model = mode === 'light' ? 'sonnet' : 'opus'
  const skipped = DISPATCHED.filter((pillar) => !run.has(pillar)).map((pillar) => ({
    pillar,
    reason: why.get(pillar) as string,
  }))
  return { upToDate, mode, effort, sinceSha, pillars, verifierModel, skipped, reasons }
}

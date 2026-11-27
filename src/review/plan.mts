import type { FollowUpContext } from './context.mts'
import type { Effort, SkippedPillar } from './finding.mts'
import { DISPATCHED_PILLARS, type Pillar } from './pillar-name.mts'
import { applyPillarSettings } from './plan-pillars.mts'
import type { PlanValues } from './plan-settings.mts'
import { NO_PILLARS, type PillarSettings } from './pillars-settings.mts'
import { chooseMode, securityPaths, type Mode, type ModeChoice } from './mode.mts'
import type { LightPush } from './push-types.mts'
import type { StackSummary } from './stack.mts'
import { isDocsOnly, isTestOrDocsOnly } from './triggers.mts'

export type Model = 'haiku' | 'sonnet' | 'opus'

/** What changed since the last reviewed SHA, from the compare API. */
export type SinceDiff = {
  /** `ahead` when the reviewed SHA is an ancestor of the head; anything else means rewritten. */
  status: string
  paths: string[]
  /** Changed lines outside generated files. */
  lines: number
  /** Changed lines of hand-written source: `lines` without tests and docs; absent means `lines` is used. */
  sourceLines?: number
  /** The compare API hit its file cap, so the real change is larger than `paths` shows. */
  truncated?: boolean
  /** Hand-written source files whose changed lines since then are SQL. */
  sqlInCode?: string[]
}

export type PlanInput = {
  paths: string[]
  /** Changed lines outside generated files (lockfiles, build output, snapshots) in the whole pull request. */
  reviewableLines: number
  /** Hand-written source files whose changed lines are SQL (`pathsChangingSql`); absent when none or not checked. */
  sqlInCode?: string[]
  context: FollowUpContext
  requested?: Effort
  since?: SinceDiff
  /**
   * The push since the last review is only merges of the base, or a rewrite with the same change
   * (local git proved it); `resolvedPaths` are the files its merge resolutions touch.
   */
  push?: { kind: LightPush; resolvedPaths: string[] }
  /** An upgraded package is on an auth or security path or crosses a pre-1.0 minor: a lockfile-only Dependabot pull request is reviewed, not skipped. */
  upgrades?: boolean
  /** Revert or hotfix subjects on the changed files; undefined when history was not checked. */
  history?: string[]
  /** Login of the pull request author; undefined or null when unknown. */
  authorLogin?: string | null
  /** The author is a bot account (GitHub actor type `Bot`). */
  authorIsBot?: boolean
  /**
   * Set (to the reason) when the author's rule must not hold because not every commit is the
   * author's, or that could not be established: the normal plan applies.
   */
  authorSuspended?: string
  /** Built-in pillars to skip and extra pillars to run; none when absent. */
  pillars?: PillarSettings
  /** Configured paths, authors and size threshold; the defaults when absent. */
  values?: PlanValues
}

export type ReviewPlan = {
  /** The newest review already covers the head; reply with it instead of reviewing. */
  upToDate: boolean
  /** `skip` posts no review; `light` runs fewer pillars with a sonnet verifier; `full` is everything. */
  mode: Mode
  /** Why a skip plan skips; absent for light and full. */
  skipReason?: string
  /** Light is `low`; full is `high`, or the requested `medium`. */
  effort: Effort
  /** Review only the diff since this SHA (light follow-up), or the whole pull request when null. */
  sinceSha: string | null
  /** Set when a light re-review covers a merge-only or same-change push, not a diff since a SHA. */
  push?: LightPush
  pillars: { pillar: Pillar; model: Model }[]
  verifierModel: Model
  skipped: SkippedPillar[]
  reasons: string[]
  /** Present when the pull request is a member of a stack; `prepare` adds it. */
  stack?: StackSummary
}

function selectPillars(input: PlanInput, choice: ModeChoice, paths: string[]) {
  const why = new Map<Pillar, string>()
  const run = new Set<Pillar>()
  const security = securityPaths(input, paths)
  const reasonFor = (text: string) => DISPATCHED_PILLARS.forEach((name) => why.set(name, text))
  if (choice.push !== undefined) {
    run.add('correctness')
    reasonFor('Light re-review of a push that only merges the base or rewrites history.')
  } else if (choice.sinceSha !== null) {
    run.add('correctness')
    for (const finding of input.context.unresolved) {
      const pillar = DISPATCHED_PILLARS.find((name) => name === finding.pillar)
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
  const settings = input.pillars ?? NO_PILLARS
  const open = input.context.unresolved.map((finding) => finding.pillar)
  const extra = applyPillarSettings(run, why, settings, {
    mode: choice.mode === 'light' ? 'light' : 'full',
    merge: choice.push !== undefined,
    open,
  })
  return { run, why, security, extra }
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
      skipped: DISPATCHED_PILLARS.map((pillar) => ({ pillar, reason })),
      reasons,
    }
  }
  // A follow-up always has `since`: chooseMode escalates to full without it.
  const paths =
    choice.push !== undefined
      ? (input.push as NonNullable<PlanInput['push']>).resolvedPaths
      : sinceSha === null
        ? input.paths
        : (input.since as SinceDiff).paths
  const { run, why, security, extra } = selectPillars(input, choice, paths)
  if (security.length > 0) reasons.push(`Security trigger: ${security.slice(0, 5).join(', ')}.`)
  const docsOnly = choice.push === undefined && isDocsOnly(paths)
  const pillars: ReviewPlan['pillars'] = [
    ...DISPATCHED_PILLARS.filter((pillar) => run.has(pillar)).map((pillar) => ({
      pillar,
      model: (docsOnly || pillar === 'history' ? 'haiku' : 'sonnet') satisfies Model as Model,
    })),
    // A configured pillar always plans the medium tier, whatever the change.
    ...extra.map((pillar) => ({ pillar, model: 'sonnet' as const })),
  ]
  const verifierModel: Model = mode === 'light' ? 'sonnet' : 'opus'
  const skipped = DISPATCHED_PILLARS.filter((pillar) => !run.has(pillar)).map((pillar) => ({
    pillar,
    reason: why.get(pillar) as string,
  }))
  return {
    upToDate,
    mode,
    effort,
    sinceSha,
    ...(choice.push === undefined ? {} : { push: choice.push }),
    pillars,
    verifierModel,
    skipped,
    reasons,
  }
}

import type { Effort } from './finding.mts'
import { authorReview, type AuthorReview } from './author-rules.mts'
import type { PlanInput } from './plan.mts'
import { DEFAULT_PLAN_VALUES } from './plan-settings.mts'
import type { LightPush } from './push-types.mts'
import {
  isDependencyFile,
  isGenerated,
  isLockfile,
  isTestOrDocsOnly,
  securityTriggers,
} from './triggers.mts'

export type Mode = 'skip' | 'light' | 'full'

export type ModeChoice = {
  mode: Mode
  effort: Effort
  /** The last reviewed SHA when only the diff since it is reviewed; null otherwise. */
  sinceSha: string | null
  /** The push kind when the light re-review covers merges or a rewrite instead of a diff since a SHA. */
  push?: LightPush
  skipReason?: string
}

/**
 * The author rule that applies to this pull request: none once its commits are not all the rule
 * author's (`authorSuspended`).
 */
export function activeAuthorReview(input: PlanInput): AuthorReview | undefined {
  if (input.authorSuspended !== undefined) return undefined
  const { authors } = input.values ?? DEFAULT_PLAN_VALUES
  return authorReview(input.authorLogin, input.authorIsBot === true, authors)
}

const full = (effort: Effort): ModeChoice => ({ mode: 'full', effort, sinceSha: null })
const light = (sinceSha: string | null): ModeChoice => ({ mode: 'light', effort: 'low', sinceSha })

function pushLight(kind: LightPush, reasons: string[]): ModeChoice {
  reasons.push(
    kind === 'base-merges-only'
      ? 'The push since the earlier review only merges the base: light review of the merge resolutions and of what came in.'
      : "History was rewritten since the earlier review but the pull request's own change is the same: light review of the range-diff and of what came in.",
  )
  return { mode: 'light', effort: 'low', sinceSha: null, push: kind }
}

function followUp(input: PlanInput, reviewedSha: string, reasons: string[]): ModeChoice {
  const { since } = input
  const escalate = (reason: string) => {
    reasons.push(`${reason} high effort.`)
    return full('high')
  }
  if (input.push !== undefined) return pushLight(input.push.kind, reasons)
  if (since === undefined || since.status !== 'ahead') {
    return escalate('The reviewed SHA is not an ancestor of the head:')
  }
  if (since.truncated === true) {
    return escalate('The diff since the reviewed SHA is too large to list:')
  }
  if (since.lines * 2 > input.reviewableLines) {
    return escalate('New commits change more than half the pull request:')
  }
  reasons.push('Follow-up after an earlier review: light review of the new commits.')
  return light(reviewedSha)
}

/**
 * The paths that trigger the security pillar. A pull request under a `light` author rule (Dependabot
 * by default) edits manifests, lockfiles, and workflow files by design, so those do not count.
 */
export function securityPaths(input: PlanInput, paths: readonly string[]): string[] {
  const { securityPaths: extra } = input.values ?? DEFAULT_PLAN_VALUES
  const hits = securityTriggers(paths, extra)
  if (activeAuthorReview(input) !== 'light') return hits
  return hits.filter((path) => !isDependencyFile(path))
}

/** Chooses skip, light, or full, and the effort the plan records for it. */
export function chooseMode(input: PlanInput, reasons: string[]): ModeChoice {
  const { context, requested } = input
  const values = input.values ?? DEFAULT_PLAN_VALUES
  const rule = activeAuthorReview(input)
  const who = input.authorLogin ?? 'the author'
  if (input.authorSuspended !== undefined) reasons.push(input.authorSuspended)
  const lockfilesOnly = input.paths.length > 0 && input.paths.every(isLockfile)
  if (rule === 'skip' || (rule === 'light' && lockfilesOnly)) {
    const skipReason =
      rule === 'skip'
        ? `Pull request by ${who}, whose plan.authors rule is skip: no review.`
        : 'Dependabot pull request that changes only lockfiles: no review.'
    if (requested === undefined) {
      reasons.push(skipReason)
      return { mode: 'skip', effort: 'low', sinceSha: null, skipReason }
    }
    reasons.push(
      rule === 'skip'
        ? `${who}'s plan.authors rule is skip: --effort ${requested} forces a review.`
        : `Dependabot lockfile-only pull request: --effort ${requested} forces a review.`,
    )
  }
  if (requested !== undefined && requested !== 'low') return full(requested)
  if (context.reviewedSha !== null) return followUp(input, context.reviewedSha, reasons)
  // No posted review, but `prepare` measured the push against this machine's unposted one.
  if (input.push !== undefined) return pushLight(input.push.kind, reasons)
  if (requested === 'low') {
    reasons.push('No earlier review: high effort.')
    return full('high')
  }
  if (rule !== undefined) {
    reasons.push('Dependabot pull request: light review.')
    return light(null)
  }
  if (isTestOrDocsOnly(input.paths)) {
    reasons.push('Only docs and tests changed: light review.')
    return light(null)
  }
  // Generated files (a lockfile is also a trigger path) do not make a pull request big or risky.
  const handWritten = input.paths.filter((path) => !isGenerated(path, values.generatedPaths))
  const small = input.reviewableLines <= values.smallChangeLines
  if (small && securityTriggers(handWritten, values.securityPaths).length === 0) {
    reasons.push(`Small pull request (${input.reviewableLines} reviewable lines): light review.`)
    return light(null)
  }
  return full('high')
}

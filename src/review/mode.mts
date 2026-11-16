import type { Effort } from './finding.mts'
import type { PlanInput } from './plan.mts'
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
  skipReason?: string
}

/** A first review of at most this many changed lines, with no security trigger path, is light. */
export const SMALL_PR_LINES = 100

const DEPENDABOT_LOGINS: readonly string[] = ['dependabot[bot]', 'app/dependabot']

/** `dependabot` alone is also a possible human login, so it counts only for a bot account. */
export function isDependabot(login: string | null | undefined, isBot: boolean): boolean {
  if (login === null || login === undefined) return false
  return DEPENDABOT_LOGINS.includes(login) || (isBot && login === 'dependabot')
}

const full = (effort: Effort): ModeChoice => ({ mode: 'full', effort, sinceSha: null })
const light = (sinceSha: string | null): ModeChoice => ({ mode: 'light', effort: 'low', sinceSha })

function followUp(input: PlanInput, reviewedSha: string, reasons: string[]): ModeChoice {
  const { context, since } = input
  const escalate = (reason: string) => {
    reasons.push(`${reason} high effort.`)
    return full('high')
  }
  if (context.truncated) return escalate('The review conversation is longer than the digest reads:')
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
 * The paths that trigger the security pillar. A Dependabot pull request edits manifests, lockfiles,
 * and workflow files by design, so those do not count for it.
 */
export function securityPaths(input: PlanInput, paths: readonly string[]): string[] {
  const hits = securityTriggers(paths)
  if (!isDependabot(input.authorLogin, input.authorIsBot === true)) return hits
  return hits.filter((path) => !isDependencyFile(path))
}

/** Chooses skip, light, or full, and the effort the plan records for it. */
export function chooseMode(input: PlanInput, reasons: string[]): ModeChoice {
  const { context, requested } = input
  const dependabot = isDependabot(input.authorLogin, input.authorIsBot === true)
  if (dependabot && input.paths.length > 0 && input.paths.every(isLockfile)) {
    if (requested === undefined) {
      const skipReason = 'Dependabot pull request that changes only lockfiles: no review.'
      reasons.push(skipReason)
      return { mode: 'skip', effort: 'low', sinceSha: null, skipReason }
    }
    reasons.push(`Dependabot lockfile-only pull request: --effort ${requested} forces a review.`)
  }
  if (requested !== undefined && requested !== 'low') return full(requested)
  if (context.reviewedSha !== null) return followUp(input, context.reviewedSha, reasons)
  if (requested === 'low') {
    reasons.push('No earlier final review: high effort.')
    return full('high')
  }
  if (dependabot) {
    reasons.push('Dependabot pull request: light review.')
    return light(null)
  }
  if (isTestOrDocsOnly(input.paths)) {
    reasons.push('Only docs and tests changed: light review.')
    return light(null)
  }
  // Generated files (a lockfile is also a trigger path) do not make a pull request big or risky.
  const handWritten = input.paths.filter((path) => !isGenerated(path))
  if (input.reviewableLines <= SMALL_PR_LINES && securityTriggers(handWritten).length === 0) {
    reasons.push(`Small pull request (${input.reviewableLines} reviewable lines): light review.`)
    return light(null)
  }
  return full('high')
}

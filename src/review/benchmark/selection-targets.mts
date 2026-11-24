import { ReviewError } from '../finding.mts'
import type { SkillChoice } from '../run/types.mts'
import { builtInTargetNames } from '../targets.mts'

function targetList(
  raw: unknown,
  field: string,
  where: string,
  known: readonly string[],
): string[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ReviewError(`${where}: ${field} must be a non-empty array`)
  }
  const seen = new Set<string>()
  return raw.map((name: unknown): string => {
    if (typeof name !== 'string' || !known.includes(name)) {
      throw new ReviewError(`${where}: ${field} contains unknown target ${JSON.stringify(name)}`)
    }
    if (seen.has(name)) throw new ReviewError(`${where}: ${field} repeats ${name}`)
    seen.add(name)
    return name
  })
}

/** Parses optional `expectedTargets` and `unwantedTargets` on a benchmark case. */
export function parseSelectionTargets(
  expectedRaw: unknown,
  unwantedRaw: unknown,
  where: string,
  known: readonly string[] = builtInTargetNames(),
): { expectedTargets?: string[]; unwantedTargets?: string[] } {
  const expectedTargets = targetList(expectedRaw, 'expectedTargets', where, known)
  const unwantedTargets = targetList(unwantedRaw, 'unwantedTargets', where, known)
  if (expectedTargets !== undefined && unwantedTargets !== undefined) {
    const both = unwantedTargets.find((name) => expectedTargets.includes(name))
    if (both !== undefined) {
      throw new ReviewError(`${where}: unwantedTargets target ${both} is also in expectedTargets`)
    }
  }
  return {
    ...(expectedTargets === undefined ? {} : { expectedTargets }),
    ...(unwantedTargets === undefined ? {} : { unwantedTargets }),
  }
}

export type TargetAttemptScore = {
  attempt: number
  hit: boolean
  missed: string[]
  unwanted: string[]
  selected: number
}

export type TargetCaseScore = {
  id: string
  expected: string[]
  unwanted: string[]
  attempts: TargetAttemptScore[]
  errors: string[]
  notRun: number[]
}

export type TargetSelectionSummary = {
  cases: number
  attempts: number
  hits: number
  hitRate: number | null
  attemptsWithUnwanted: number
  unwantedSelections: number
}

/** Scores target selection across one case's attempts. */
export function scoreSelectionTargetCase(
  id: string,
  expected: readonly string[],
  unwanted: readonly string[],
  choices: ReadonlyArray<SkillChoice | undefined>,
): TargetCaseScore {
  const score: TargetCaseScore = {
    id,
    expected: [...expected],
    unwanted: [...unwanted],
    attempts: [],
    errors: [],
    notRun: [],
  }
  choices.forEach((choice, index) => {
    const attempt = index + 1
    if (choice === undefined) score.notRun.push(attempt)
    else if (choice.error !== undefined) score.errors.push(`attempt ${attempt}: ${choice.error}`)
    else {
      const chosen = choice.targets ?? []
      const missed = expected.filter((name) => !chosen.includes(name))
      const bad = unwanted.filter((name) => chosen.includes(name))
      score.attempts.push({
        attempt,
        hit: missed.length === 0 && bad.length === 0,
        missed,
        unwanted: bad,
        selected: chosen.length,
      })
    }
  })
  return score
}

/** Null when no case declares target expectations. */
export function summarizeSelectionTargets(
  scores: readonly TargetCaseScore[],
): TargetSelectionSummary | null {
  if (scores.length === 0) return null
  const attempts = scores.flatMap((score) => score.attempts)
  const hits = attempts.filter((attempt) => attempt.hit).length
  const attemptsWithUnwanted = attempts.filter((attempt) => attempt.unwanted.length > 0).length
  const unwantedSelections = attempts.reduce((sum, attempt) => sum + attempt.unwanted.length, 0)
  return {
    cases: scores.length,
    attempts: attempts.length,
    hits,
    hitRate: attempts.length === 0 ? null : hits / attempts.length,
    attemptsWithUnwanted,
    unwantedSelections,
  }
}

const percent = (hits: number, total: number): string =>
  total === 0 ? 'n/a' : `${Math.round((100 * hits) / total)}%`

/** The totals line for `summary.md`. */
export function targetSelectionTotals(summary: TargetSelectionSummary): string {
  const { hits, attempts, attemptsWithUnwanted, unwantedSelections } = summary
  return `- Target selection: ${hits} of ${attempts} attempts (${percent(hits, attempts)}) matched; unwanted in ${attemptsWithUnwanted} of ${attempts} (${unwantedSelections} total)`
}

/** Per-case target selection table for `summary.md`. */
export function renderTargetSelection(scores: readonly TargetCaseScore[]): string[] {
  if (scores.length === 0) return []
  const rows = scores.map((score) => {
    const hits = score.attempts.filter((attempt) => attempt.hit).length
    const missed = score.expected
      .map((name) => [name, score.attempts.filter((a) => a.missed.includes(name)).length] as const)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name} x${count}`)
      .join(', ')
    const unwanted = score.unwanted
      .map(
        (name) => [name, score.attempts.filter((a) => a.unwanted.includes(name)).length] as const,
      )
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name} x${count}`)
      .join(', ')
    return `| ${score.id} | ${score.expected.join(', ')} | ${score.unwanted.join(', ')} | ${hits} of ${score.attempts.length} | ${missed} | ${unwanted} |`
  })
  return [
    '## Target selection per case',
    [
      '| Case | Expected | Unwanted | Hits | Missed | Unwanted selected |',
      '| --- | --- | --- | --- | --- | --- |',
      ...rows,
    ].join('\n'),
  ]
}

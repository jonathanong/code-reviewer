import { HARNESS_FAILURE_KINDS, type HarnessFailureKind } from '../harness/failure-kind.mts'
import { builtinPillar } from '../review/pillar-name.mts'
import type { HarnessFailureRow } from '../tracker/failures.mts'
import { HARNESS_TARGET } from './config-parse.mts'
import { markerOf, type IssueProposal } from './proposals.mts'

/** A harness needs at least this many failed steps of one kind before it is proposed. */
export const HARNESS_MIN_FAILURES = 3

const MEANING: Record<HarnessFailureKind, string> = {
  timeout: 'timed out',
  rate_limited: 'kept hitting a rate limit past the retry budget',
  overloaded: 'kept hitting overload past the retry budget',
  unsupported_flag: 'was rejected for an unsupported flag',
  crash: 'exited without a result',
  unparseable: 'printed output with no parseable JSON result',
}

const ADVICE: Record<HarnessFailureKind, string> = {
  timeout: "check the adapter's timeout handling and whether the harness hangs.",
  rate_limited: 'check how the adapter classifies and waits out this harness rate limit.',
  overloaded: 'check how the adapter classifies and waits out this harness overload.',
  unsupported_flag: "check the adapter's arguments against this harness version.",
  crash: "check why the harness exits without a result and whether the adapter's arguments fit it.",
  unparseable: "check the adapter's output parsing against this harness version.",
}

/** Built-in step names only: a configured pillar's name stays on the machine. */
const stepName = (step: string) =>
  step === 'selection' ||
  step === 'verifier' ||
  step === 'evidence' ||
  step === 'approval check' ||
  builtinPillar(step) !== undefined
    ? step
    : 'configured pillar'

/**
 * One proposal for each harness and failure kind with at least `HARNESS_MIN_FAILURES` failed
 * steps. The body holds the harness name, the failure kind, step names, a count and dates; never
 * an error message, a repository, a path or code. The harness version is not recorded.
 */
export function harnessProposals(failures: readonly HarnessFailureRow[]): IssueProposal[] {
  const harnesses = [...new Set(failures.map((row) => row.harness))].sort()
  return harnesses.flatMap((harness) =>
    HARNESS_FAILURE_KINDS.flatMap((kind) => {
      const rows = failures.filter((row) => row.harness === harness && row.kind === kind)
      if (rows.length < HARNESS_MIN_FAILURES) return []
      const key = `harness:${harness}:${kind}`
      const dates = rows.map((row) => row.at.slice(0, 10)).sort()
      const steps = [...new Set(rows.map((row) => stepName(row.step)))].sort().map((step) => {
        const n = rows.filter((row) => stepName(row.step) === step).length
        return `${step} ${n}`
      })
      return [
        {
          key,
          target: HARNESS_TARGET,
          title: `Harness ${harness}: ${rows.length} steps failed (${MEANING[kind]})`,
          body: [
            `The code reviewer's \`${harness}\` harness failed ${rows.length} steps: each ${MEANING[kind]}, between ${dates[0]} and ${dates.at(-1)}.`,
            '',
            `Steps: ${steps.join(', ')}.`,
            '',
            `Proposed: ${ADVICE[kind]}`,
            '',
            markerOf(key),
            '',
          ].join('\n'),
        },
      ]
    }),
  )
}

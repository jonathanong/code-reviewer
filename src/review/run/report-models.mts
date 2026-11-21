import type { StepRan } from '../../harness/runner.mts'
import type { ApprovalCheck } from './approval-check.mts'
import type { EvidenceReport } from './evidence-types.mts'
import type { PillarResult, SkillChoice } from './types.mts'

/** Which harness and model ran a step, and how long it waited on rate limits first. */
export type RanRow = StepRan & { step: string }

/** One row per step that ran, in review order; a step whose record is absent (an older run) has none. */
export function ranRows(input: {
  skillSelection: SkillChoice
  pillars: readonly PillarResult[]
  verifier: { ran?: StepRan | undefined } | undefined
  evidence?: EvidenceReport | undefined
  approvalCheck?: ApprovalCheck | undefined
}): RanRow[] {
  const steps: Array<[string, StepRan | undefined]> = [
    ['selection', input.skillSelection.ran],
    ...input.pillars.map((pillar): [string, StepRan | undefined] => [pillar.pillar, pillar.ran]),
    ['verifier', input.verifier?.ran],
    ['evidence', input.evidence?.ran],
    ['approval check', input.approvalCheck?.ran],
  ]
  return steps.flatMap(([step, ran]) => (ran === undefined ? [] : [{ step, ...ran }]))
}

/** The "Models" table of `report.md`; nothing when no step recorded its model. */
export function renderRan(rows: readonly RanRow[]): string[] {
  if (rows.length === 0) return []
  return [
    '### Models',
    [
      '| Step | Harness | Model | Waited on rate limits |',
      '| --- | --- | --- | --- |',
      ...rows.map(
        (row) =>
          `| ${row.step} | ${row.harness} | ${row.model} | ${Math.round(row.waitedMs / 1000)}s |`,
      ),
    ].join('\n'),
  ]
}

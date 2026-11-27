import type { StepRan } from '../../harness/runner.mts'
import type { Usage } from '../benchmark/usage.mts'
import { summarizeModels } from '../benchmark/usage-summary.mts'
import type { Verdict } from '../render.mts'
import type { ReportData } from '../run/report.mts'

/** One reply-only re-assessment, kept in `report.json` of the head it re-assessed. */
export type RepliesRecord = {
  at: string
  settled: number
  downgraded: number
  open: number
  verdictBefore: Verdict
  verdictAfter: Verdict
  /** A new review was posted because the verdict changed. */
  posted: boolean
  /** What the approval check said when the re-assessment would approve; absent when none was needed or it is off. */
  approval?: 'upheld' | 'not upheld'
  costUsd: number | null
}

const money = (value: number | null) => (value === null ? 'n/a' : `$${value.toFixed(4)}`)

/** The "Replies" section of `report.md`; nothing when no re-assessment ran. */
export function renderReplies(records: readonly RepliesRecord[] | undefined): string[] {
  if (records === undefined || records.length === 0) return []
  return [
    '### Replies re-assessed',
    records
      .map(
        (record) =>
          `- ${record.at}: ${record.settled} settled, ${record.downgraded} lowered, ${record.open} still open; verdict ${record.verdictBefore} to ${record.verdictAfter}${record.posted ? ' (posted)' : ''}${record.approval === undefined ? '' : `; approval check ${record.approval}`}; ${money(record.costUsd)}`,
      )
      .join('\n'),
  ]
}

/** The report with this step's cost in the cost table and the model that ran it in `ran`. */
export function withStepCost(
  data: ReportData,
  step: string,
  usage: Usage | null,
  ran: StepRan | undefined,
): ReportData {
  return {
    ...data,
    usageByModel: [
      ...data.usageByModel,
      { name: step, models: summarizeModels(usage === null ? [] : [usage]) },
    ],
    ran: [...(data.ran ?? []), ...(ran === undefined ? [] : [{ step, ...ran }])],
  }
}

/** The report with the re-assessment's record, and its cost under the `replies` step. */
export function withReplies(
  data: ReportData,
  record: RepliesRecord,
  usage: Usage | null,
  ran: StepRan | undefined,
): ReportData {
  return withStepCost(
    { ...data, replies: [...(data.replies ?? []), record] },
    'replies',
    usage,
    ran,
  )
}

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
          `- ${record.at}: ${record.settled} settled, ${record.downgraded} lowered, ${record.open} still open; verdict ${record.verdictBefore} to ${record.verdictAfter}${record.posted ? ' (posted)' : ''}; ${money(record.costUsd)}`,
      )
      .join('\n'),
  ]
}

/** The report with the re-assessment's cost under the `replies` step and its model in `ran`. */
export function withReplies(
  data: ReportData,
  record: RepliesRecord,
  usage: Usage | null,
  ran: StepRan | undefined,
): ReportData {
  return {
    ...data,
    replies: [...(data.replies ?? []), record],
    usageByModel: [
      ...data.usageByModel,
      { name: 'replies', models: summarizeModels(usage === null ? [] : [usage]) },
    ],
    ran: [...(data.ran ?? []), ...(ran === undefined ? [] : [{ step: 'replies', ...ran }])],
  }
}

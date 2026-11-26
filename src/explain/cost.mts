import { costBreakdown, type ReportData } from '../review/run/report.mts'
import type { Json } from '../tracker/json.mts'

/** The run's total cost, or null when the report cannot be priced. */
export function cost(report: Json): number | null {
  try {
    return costBreakdown(report as unknown as ReportData).total
  } catch {
    return null
  }
}

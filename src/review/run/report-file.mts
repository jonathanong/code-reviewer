import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { FinalReviewError } from '../finding.mts'
import type { ReportData } from './report.mts'
import { renderReport } from './report-render.mts'

/** Writes `report.json` and the `report.md` rendered from it; returns the Markdown path. */
export function writeReportFiles(out: string, data: ReportData): string {
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(data, null, 2)}\n`)
  return writeReportMarkdown(out, data)
}

function writeReportMarkdown(out: string, data: ReportData): string {
  const path = join(out, 'report.md')
  writeFileSync(path, renderReport(data))
  return path
}

/** `code-reviewer report`: renders `report.md` again from `report.json`. */
export function rerenderReport(out: string): string {
  const data = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as { version?: unknown }
  if (data?.version !== 1) throw new FinalReviewError('report.json is not a version 1 report.')
  return writeReportMarkdown(out, data as ReportData)
}

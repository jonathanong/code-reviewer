import type { TrackerRow } from './types.mts'

export const FORMATS = ['json', 'csv', 'markdown'] as const
export type Format = (typeof FORMATS)[number]

const COLUMNS = [
  'repo',
  'pr',
  'title',
  'author',
  'head',
  'mode',
  'verdict',
  'blocking',
  'high',
  'medium',
  'low',
  'questions',
  'costUsd',
  'startedAt',
  'finishedAt',
  'state',
  'reason',
  'reviewUrl',
  'event',
  'postedAt',
  'runDir',
] as const

function cells(row: TrackerRow): Array<string | number | null> {
  const { counts, ...rest } = row
  const flat: Record<string, string | number | null> = {
    ...rest,
    blocking: counts?.blocking ?? null,
    high: counts?.high ?? null,
    medium: counts?.medium ?? null,
    low: counts?.low ?? null,
  }
  return COLUMNS.map((column) => flat[column] as string | number | null)
}

/** A spreadsheet runs a text cell that starts with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/u

function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const text = typeof value === 'number' ? String(value) : value
  const safe = FORMULA_START.test(text) ? `'${text}` : text
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

function markdownCell(value: string | number | null): string {
  return value === null ? '' : String(value).replaceAll('|', '\\|').replace(/\s+/gu, ' ')
}

export function formatRows(rows: readonly TrackerRow[], format: Format): string {
  if (format === 'json') return `${JSON.stringify(rows, null, 2)}\n`
  if (format === 'csv') {
    const lines = [COLUMNS.join(','), ...rows.map((row) => cells(row).map(csvCell).join(','))]
    return `${lines.join('\r\n')}\r\n`
  }
  const lines = [
    `| ${COLUMNS.join(' | ')} |`,
    `| ${COLUMNS.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${cells(row).map(markdownCell).join(' | ')} |`),
  ]
  return `${lines.join('\n')}\n`
}

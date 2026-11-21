import type { ModelsReport } from './types.mts'

const cell = (value: number | null, digits: number): string =>
  value === null ? '-' : value.toFixed(digits)

/** The report as a Markdown table, one row per model, in rank order. */
export function renderTable(report: ModelsReport): string {
  const rows = report.models.map((model) =>
    [
      model.id,
      String(model.runs),
      cell(model.valid, 2),
      cell(model.found, 2),
      cell(model.extra, 1),
      cell(model.seconds, 1),
      cell(model.tokens, 0),
      cell(model.costUsd, 4),
      String(model.rateLimited),
      model.failures.length === 0 ? '' : model.failures.join('; ').replaceAll('|', '\\|'),
    ].join(' | '),
  )
  return [
    `Harness: ${report.harness}`,
    '',
    '| model | runs | valid | found | extra | seconds | tokens | cost USD | rate limited | failures |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows.map((row) => `| ${row} |`),
    '',
  ].join('\n')
}

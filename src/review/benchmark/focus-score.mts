import type { Finding } from '../finding.mts'
import type { FocusAnswer, FocusStatus } from '../focus.mts'
import type { FocusCasePoint } from './focus-case.mts'
import { renderModelReports, type ModelReport } from './model-usage.mts'
import { summarizeUsage } from './usage-summary.mts'
import type { Usage } from './usage.mts'

export type FocusRawResult = {
  id: string
  answers: FocusAnswer[]
  findings: Finding[]
  usage: Usage | null
  error?: string
}

export type FocusPointScore = {
  index: number
  point: string
  expectedStatus: FocusStatus
  returnedStatus: FocusStatus
  basis: string
  pass: boolean
  findingViolation?: boolean
  /** True when the status matched but the basis did not match the case's `basisPattern`. */
  basisViolation?: boolean
}

export type FocusCaseScore = {
  id: string
  points: FocusPointScore[]
  passed: number
  total: number
  findings: number
  costUsd: number | null
  error?: string
  notRun: boolean
}

export type FocusSummary = {
  cases: number
  scored: number
  passed: number
  total: number
  rate: number | null
  errors: number
  notRun: number
  costUsd: number | null
}

/** Deterministically grades one case's focus answers against its expected statuses. */
export function scoreFocusCase(
  id: string,
  expected: readonly FocusCasePoint[],
  raw: FocusRawResult | undefined,
): FocusCaseScore {
  if (raw === undefined) {
    return {
      id,
      points: [],
      passed: 0,
      total: expected.length,
      findings: 0,
      costUsd: null,
      notRun: true,
    }
  }
  const costUsd = raw.usage?.costUsd ?? null
  if (raw.error !== undefined) {
    return {
      id,
      points: [],
      passed: 0,
      total: expected.length,
      findings: raw.findings.length,
      costUsd,
      error: raw.error,
      notRun: false,
    }
  }
  const points = expected.map((item, index): FocusPointScore => {
    const answer = raw.answers[index]
    const returnedStatus = answer?.status ?? 'not_checked'
    const basis = answer?.basis ?? 'No answer returned.'
    const findingViolation = item.expectNoFindings === true && raw.findings.length > 0
    const statusMatch = returnedStatus === item.expectedStatus
    const basisViolation =
      statusMatch &&
      item.basisPattern !== undefined &&
      !new RegExp(item.basisPattern, 'iu').test(basis)
    const pass = statusMatch && !findingViolation && !basisViolation
    return {
      index,
      point: item.point,
      expectedStatus: item.expectedStatus,
      returnedStatus,
      basis,
      pass,
      ...(findingViolation ? { findingViolation: true } : {}),
      ...(basisViolation ? { basisViolation: true } : {}),
    }
  })
  return {
    id,
    points,
    passed: points.filter((point) => point.pass).length,
    total: expected.length,
    findings: raw.findings.length,
    costUsd,
    notRun: false,
  }
}

export function summarizeFocus(
  scores: readonly FocusCaseScore[],
  usages: readonly Usage[],
): FocusSummary {
  const scored = scores.filter((score) => !score.notRun && score.error === undefined)
  const passed = scored.reduce((sum, score) => sum + score.passed, 0)
  const total = scored.reduce((sum, score) => sum + score.total, 0)
  return {
    cases: scores.length,
    scored: scored.length,
    passed,
    total,
    rate: total === 0 ? null : passed / total,
    errors: scores.filter((score) => score.error !== undefined).length,
    notRun: scores.filter((score) => score.notRun).length,
    costUsd: summarizeUsage(usages).totalCostUsd,
  }
}

const percent = (passed: number, total: number) =>
  total === 0 ? 'n/a' : `${Math.round((100 * passed) / total)}%`

const dollars = (value: number | null) => (value === null ? 'n/a' : `$${value.toFixed(2)}`)

/** Renders `summary.md`: totals, per-case table, every wrong point with its basis, and model usage. */
export function renderFocus(
  scores: readonly FocusCaseScore[],
  summary: FocusSummary,
  models: ModelReport,
): string {
  const rows = scores.map((score) => {
    const status = score.notRun
      ? 'not run'
      : score.error !== undefined
        ? 'error'
        : score.passed === score.total
          ? 'pass'
          : 'fail'
    const correct =
      score.notRun || score.error !== undefined ? '-' : `${score.passed} of ${score.total}`
    return `| ${score.id} | ${correct} | ${score.findings} | ${dollars(score.costUsd)} | ${status} |`
  })
  const wrong = scores.flatMap((score) =>
    score.points
      .filter((point) => !point.pass)
      .map((point) => {
        const extra = point.findingViolation
          ? `; returned ${score.findings} finding(s), expected 0`
          : point.basisViolation
            ? '; the basis does not match the expected pattern'
            : ''
        return `- ${score.id}[${point.index}] "${point.point}": expected \`${point.expectedStatus}\`, got \`${point.returnedStatus}\`${extra}. Basis: ${point.basis}`
      }),
  )
  const problems = scores.flatMap((score) => [
    ...(score.error === undefined ? [] : [`- ${score.id}: ${score.error}`]),
    ...(score.notRun ? [`- ${score.id}: not run`] : []),
  ])
  return [
    '## Totals',
    [
      `- Cases: ${summary.cases} (${summary.scored} scored)`,
      `- Points correct: ${summary.passed} of ${summary.total} (${percent(summary.passed, summary.total)})`,
      `- Errors: ${summary.errors}; not run: ${summary.notRun}`,
      `- Cost: ${dollars(summary.costUsd)}`,
    ].join('\n'),
    '## Per case',
    [
      '| Case | Correct | Findings | Cost | Status |',
      '| --- | --- | ---: | ---: | --- |',
      ...rows,
    ].join('\n'),
    ...(wrong.length > 0 ? ['## Wrong points', wrong.join('\n')] : []),
    '## Tokens by model',
    renderModelReports([models]),
    ...(problems.length > 0 ? ['## Errors', problems.join('\n')] : []),
  ].join('\n\n')
}

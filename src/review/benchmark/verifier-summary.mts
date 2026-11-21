import { join } from 'node:path'

import type { EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import type { Usage } from './usage.mts'
import { renderModelReports, summarizeByModel } from './model-usage.mts'
import { collectUsage, gradeInputs, type VerifierRaw } from './verifier-grade.mts'
import {
  renderVerifierTable,
  scoreVerifierCase,
  summarizeVerifier,
  type VerifierCaseScore,
} from './verifier-score.mts'

export function readRaw(path: string, deps: BenchDeps): VerifierRaw | undefined {
  return deps.exists(path) ? (JSON.parse(deps.readFile(path)) as VerifierRaw) : undefined
}

type SummaryOptions = { out: string; judge: string; checker: string; noRules?: boolean }

/** Scores the saved results and writes `summary.json` and `summary.md` with the model usage. */
export function scoreAll(cases: EvalCase[], options: SummaryOptions, deps: BenchDeps): string {
  const scores: VerifierCaseScore[] = []
  const errors: string[] = []
  const verifierUsage: Array<Usage | null> = []
  const checkerUsage: Usage[] = []
  for (const item of cases) {
    const raw = readRaw(join(options.out, 'raw', `${item.id}.json`), deps)
    if (raw === undefined) {
      verifierUsage.push(null)
      errors.push(`- ${item.id}: not run`)
      continue
    }
    if ('error' in raw) {
      verifierUsage.push(null)
      errors.push(`- ${item.id}: ${raw.error}`)
      continue
    }
    collectUsage(raw, verifierUsage, checkerUsage)
    if (raw.graded?.inputs !== gradeInputs(item, raw.output, [options.judge, options.checker]))
      errors.push(`- ${item.id}: not graded`)
    else scores.push(scoreVerifierCase(item, raw.input, raw.output, raw.graded))
  }
  const summary = summarizeVerifier(scores)
  const arm = options.noRules === true ? 'control' : 'with skills'
  const models = [
    summarizeByModel('verifier', arm, verifierUsage),
    // The checker runs only on cases with strong findings, so only its recorded runs are expected.
    summarizeByModel('checker', arm, checkerUsage),
  ]
  deps.writeFile(
    join(options.out, 'summary.json'),
    `${JSON.stringify({ summary, scores, errors, models }, null, 2)}\n`,
  )
  const markdown = [
    `Labels judged by ${options.judge}; other blocking and high findings checked by ${options.checker}.`,
    renderVerifierTable(summary),
    'Tokens by model (each figure is total / per run; Runs is using the model of covered of expected; the judge calls are not counted):',
    renderModelReports(models),
    ...(errors.length > 0 ? ['Errors:', errors.join('\n')] : []),
  ].join('\n\n')
  deps.writeFile(join(options.out, 'summary.md'), `${markdown}\n`)
  return markdown
}

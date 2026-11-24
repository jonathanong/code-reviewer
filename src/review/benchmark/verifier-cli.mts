import { describeStepFailure } from '../../harness/runner.mts'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import { PILLARS } from '../pillar-name.mts'
import { parseEvalCases, type EvalCase } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { pool } from '../run/pool.mts'
import { judgeAll } from './judge-all.mts'
import { benchPlugins } from './plugin-settings.mts'
import { gradeAll, type VerifierRaw } from './verifier-grade.mts'
import { readRaw, scoreAll } from './verifier-summary.mts'
import { collectVerifierInput, type VerifierInput } from './verifier-input.mts'
import {
  defaultVerifierDeps,
  prepareVerifierSnapshot,
  type VerifierBenchDeps,
} from './verifier-snapshot.mts'
import { runVerifier } from './verifier-run.mts'
import { verifierRunInputs, type VerifierRun } from './verifier-key.mts'
import { DEFAULT_RULE_PLUGINS } from '../plugins.mts'
import { answerRules } from '../run/answers-rules.mts'

type Options = {
  findingsFrom: string
  out: string
  prompts: string
  model: string
  maxTurns: number
  jobs: number
  judge: string
  checker: string
  noRules: boolean
}

function errorMessage(error: unknown): string {
  return describeStepFailure(error).message
}

function writeRaw(item: EvalCase, raw: VerifierRaw, options: Options, deps: BenchDeps): void {
  deps.writeFile(join(options.out, 'raw', `${item.id}.json`), `${JSON.stringify(raw, null, 2)}\n`)
}

/** verifier.md with the files it links inlined, since the snapshot has no skill files. */
function verifierPrompt(prompts: string, deps: BenchDeps): string {
  return [
    deps.readFile(join(prompts, 'verifier.md')).trim(),
    deps.readFile(join(prompts, 'pillars', '_contract.md')).trim(),
    deps.readFile(join(prompts, 'pillars', 'congruence.md')).trim(),
  ].join('\n\n')
}

async function runAll(cases: EvalCase[], options: Options, deps: VerifierBenchDeps): Promise<void> {
  const { settings, installs } = await benchPlugins(
    deps.exec,
    process.cwd(),
    !options.noRules,
    (line) => deps.log(line),
  )
  const run: VerifierRun = {
    verifierPrompt: verifierPrompt(options.prompts, deps),
    model: options.model,
    maxTurns: options.maxTurns,
    ...(settings === undefined ? {} : { settings }),
  }
  const citable = cases.some((item) => item.answerable !== undefined)
    ? answerRules(installs, DEFAULT_RULE_PLUGINS, [])
    : undefined
  const tasks = cases.flatMap((item) => {
    let input: VerifierInput | null
    try {
      input = collectVerifierInput(item, options.findingsFrom, options.judge, deps)
    } catch (error) {
      // Without current labels the case can't be scored, so record it instead of verifying it.
      writeRaw(item, { error: errorMessage(error) }, options, deps)
      return []
    }
    if (input === null) {
      deps.log(`skip ${item.id}: no pillar findings`)
      return []
    }
    return [{ item, input }]
  })
  await pool(tasks, options.jobs, async ({ item, input }) => {
    let raw: VerifierRaw
    try {
      // The rules digest keys a saved output, so staging comes before the resume check.
      const { dir, rules } = await prepareVerifierSnapshot(item, options, deps)
      const inputs = verifierRunInputs(item, input, run, rules)
      // A saved output is reused only for the same run, so a resume never reports stale results.
      const saved = readRaw(join(options.out, 'raw', `${item.id}.json`), deps)
      if (saved !== undefined && 'output' in saved && saved.inputs === inputs) return
      deps.log(`verify ${item.id}`)
      const done = await runVerifier(item, dir, input.findings, run, deps.exec, citable)
      const { output, usage, answers, disproved } = done
      raw = {
        input,
        inputs,
        output,
        usage,
        ...(answers === undefined ? {} : { answers }),
        ...(disproved === undefined ? {} : { disproved }),
      }
    } catch (error) {
      raw = { input, error: errorMessage(error) }
    }
    writeRaw(item, raw, options, deps)
  })
}

/**
 * `code-reviewer bench-verifier`: run the verifier alone on saved pillar findings, one
 * model call per case and no subagents, and score what it keeps, merges, and drops.
 */
export async function runReviewVerifierBenchCli(
  args: string[],
  deps: VerifierBenchDeps = defaultVerifierDeps,
): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      cases: { type: 'string' },
      'findings-from': { type: 'string' },
      prompts: { type: 'string' },
      out: { type: 'string' },
      case: { type: 'string', multiple: true },
      model: { type: 'string' },
      'max-turns': { type: 'string' },
      jobs: { type: 'string' },
      'score-only': { type: 'boolean' },
      judge: { type: 'string' },
      checker: { type: 'string' },
      'no-rules': { type: 'boolean' },
    },
  })
  const { cases: casesPath, out } = values
  const findingsFrom = values['findings-from']
  if (casesPath === undefined || out === undefined || findingsFrom === undefined)
    throw new Error('bench-verifier needs --cases, --findings-from, and --out.')
  const scoreOnly = values['score-only'] === true
  if (!scoreOnly && values.prompts === undefined) throw new Error('bench-verifier needs --prompts.')
  const ids = new Set(values.case ?? [])
  const cases = parseEvalCases(
    JSON.parse(deps.readFile(casesPath)) as unknown,
    dirname(casesPath),
  ).filter((item) => ids.size === 0 || ids.has(item.id))
  const options: Options = {
    findingsFrom,
    out,
    prompts: values.prompts ?? '',
    model: values.model ?? 'opus',
    maxTurns: Number(values['max-turns'] ?? '60'),
    jobs: Number(values.jobs ?? '3'),
    judge: values.judge ?? 'sonnet',
    checker: values.checker ?? 'opus',
    noRules: values['no-rules'] === true,
  }
  if (!scoreOnly) {
    await judgeAll(
      cases,
      PILLARS,
      { out: findingsFrom, model: options.judge, jobs: options.jobs },
      deps,
    )
    await runAll(cases, options, deps)
    await gradeAll(cases, options, deps)
  }
  process.stdout.write(`${scoreAll(cases, options, deps)}\n`)
  return 0
}

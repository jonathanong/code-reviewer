import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import { pluginRoot } from '../../plugin-root.mts'
import { resolveModelPlan, type StepModels } from '../models.mts'
import { runFocus } from '../run/focus-run.mts'
import { pool } from '../run/pool.mts'
import { parseEvalCases, type EvalCase } from './cases.mts'
import { defaultBenchDeps, type BenchDeps } from './cli.mts'
import type { FocusCasePoint } from './focus-case.mts'
import { prepareFocusCase } from './focus-prepare.mts'
import {
  renderFocus,
  scoreFocusCase,
  summarizeFocus,
  type FocusCaseScore,
  type FocusRawResult,
} from './focus-score.mts'
import { summarizeByModel } from './model-usage.mts'
import { benchPlugins } from './plugin-settings.mts'
import { stageCaseRules } from './rules.mts'
import type { Usage } from './usage.mts'

export type FocusBenchDeps = BenchDeps & {
  prepareFocus: typeof prepareFocusCase
  stageRules: typeof stageCaseRules
  runFocus: typeof runFocus
}

export const defaultFocusDeps: FocusBenchDeps = {
  ...defaultBenchDeps,
  prepareFocus: prepareFocusCase,
  stageRules: stageCaseRules,
  runFocus,
}

type FocusCase = EvalCase & { focus: FocusCasePoint[] }

type Options = {
  out: string
  cache: string
  prompts: string
  mode: 'light' | 'full'
  model: string | undefined
  jobs: number
  noRules: boolean
}

const rawPath = (out: string, id: string) => join(out, 'raw', `${id}.json`)

function positive(value: string, name: string): number {
  const count = Number(value)
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`--${name} must be a positive integer.`)
  }
  return count
}

function parseMode(value: string | undefined): 'light' | 'full' {
  if (value === undefined || value === 'full') return 'full'
  if (value === 'light') return 'light'
  throw new Error('--mode must be light or full.')
}

function modelsFor(model: string | undefined): StepModels | undefined {
  if (model === undefined) return undefined
  return { plan: resolveModelPlan(undefined, { focus: [{ harness: 'claude', model }] }) }
}

async function runAll(
  cases: readonly FocusCase[],
  options: Options,
  deps: FocusBenchDeps,
): Promise<void> {
  const { settings } = await benchPlugins(deps.exec, process.cwd(), !options.noRules, (line) =>
    deps.log(line),
  )
  const contract = deps.readFile(join(options.prompts, 'pillars', '_contract.md'))
  const models = modelsFor(options.model)
  await pool(cases, options.jobs, async (item) => {
    deps.log(`focus ${item.id}`)
    let raw: FocusRawResult
    try {
      const prepared = await deps.prepareFocus(
        item,
        { cache: options.cache, work: join(options.out, 'work'), noRules: options.noRules },
        { exec: deps.exec, prepare: deps.prepare, stageRules: deps.stageRules },
      )
      const done = await deps.runFocus({
        points: item.focus.map((entry) => entry.point),
        tree: prepared.tree,
        run: { out: prepared.out, sinceSha: null, hasRules: prepared.hasRules },
        baseSha: prepared.baseSha,
        headSha: prepared.headSha,
        mode: options.mode,
        contract,
        ...(settings === undefined ? {} : { settings }),
        ...(models === undefined ? {} : { models }),
        exec: deps.exec,
      })
      raw = {
        id: item.id,
        answers: done.answers,
        findings: done.result.findings,
        usage: done.result.usage,
        ...(done.result.error === undefined ? {} : { error: done.result.error }),
      }
    } catch (error) {
      raw = {
        id: item.id,
        answers: [],
        findings: [],
        usage: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    deps.writeFile(rawPath(options.out, item.id), `${JSON.stringify(raw, null, 2)}\n`)
  })
}

function scoreAll(cases: readonly FocusCase[], out: string, deps: BenchDeps): string {
  const scores: FocusCaseScore[] = []
  const usages: Usage[] = []
  const runs: Array<Usage | null> = []
  for (const item of cases) {
    const file = rawPath(out, item.id)
    const raw = deps.exists(file) ? (JSON.parse(deps.readFile(file)) as FocusRawResult) : undefined
    runs.push(raw?.usage ?? null)
    if (raw?.usage !== undefined && raw.usage !== null) usages.push(raw.usage)
    scores.push(scoreFocusCase(item.id, item.focus, raw))
  }
  const summary = summarizeFocus(scores, usages)
  const models = summarizeByModel('focus', null, runs)
  const report = renderFocus(scores, summary, models)
  deps.writeFile(
    join(out, 'summary.json'),
    `${JSON.stringify({ summary, scores, models: [models] }, null, 2)}\n`,
  )
  const summaryPath = join(out, 'summary.md')
  deps.writeFile(summaryPath, `${report}\n`)
  return JSON.stringify({ summary: summaryPath, ...summary })
}

/**
 * `code-reviewer bench-focus`: runs the real focus step (`runFocus` with computed change facts) on
 * every case declaring `focus`, and grades each point deterministically against `expectedStatus`.
 */
export async function runReviewFocusBenchCli(
  args: string[],
  deps: FocusBenchDeps = defaultFocusDeps,
): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      cases: { type: 'string', multiple: true },
      out: { type: 'string' },
      case: { type: 'string', multiple: true },
      prompts: { type: 'string' },
      model: { type: 'string' },
      mode: { type: 'string' },
      jobs: { type: 'string' },
      cache: { type: 'string' },
      'no-rules': { type: 'boolean' },
      'score-only': { type: 'boolean' },
    },
  })
  const files = values.cases ?? []
  if (files.length === 0 || values.out === undefined) {
    throw new Error('bench-focus needs --cases and --out.')
  }
  const ids = new Set(values.case ?? [])
  const cases = files
    .flatMap((file) => parseEvalCases(JSON.parse(deps.readFile(file)) as unknown, dirname(file)))
    .filter((item): item is FocusCase => item.focus !== undefined)
    .filter((item) => ids.size === 0 || ids.has(item.id))
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error('bench-focus case ids must be unique across --cases files.')
  }
  if (cases.length === 0) throw new Error('bench-focus found no cases with focus.')
  const options: Options = {
    out: values.out,
    cache: values.cache ?? join(values.out, 'cache'),
    prompts: values.prompts ?? join(pluginRoot(), 'skills/review/references'),
    mode: parseMode(values.mode),
    model: values.model,
    jobs: positive(values.jobs ?? '3', 'jobs'),
    noRules: values['no-rules'] === true,
  }
  if (values['score-only'] !== true) await runAll(cases, options, deps)
  process.stdout.write(`${scoreAll(cases, options.out, deps)}\n`)
  return 0
}

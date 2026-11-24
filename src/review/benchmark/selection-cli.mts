import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import {
  DEFAULT_RULE_PLUGINS,
  parsePluginInstalls,
  parsePluginList,
  pluginSettings,
} from '../plugins.mts'
import { pool } from '../run/pool.mts'
import { listRuleSkills, selectSkills } from '../run/select-skills.mts'
import type { SkillChoice } from '../run/types.mts'
import { builtInTargets } from '../targets.mts'
import { parseEvalCases, type EvalCase } from './cases.mts'
import { defaultBenchDeps, type BenchDeps } from './cli.mts'
import { selectionText, type SelectionText } from './selection-input.mts'
import {
  renderSelection,
  scoreSelectionCase,
  summarizeSelection,
  type SelectionCaseScore,
} from './selection-score.mts'
import {
  scoreSelectionTargetCase,
  summarizeSelectionTargets,
  type TargetCaseScore,
} from './selection-targets.mts'
import { summarizeByModel } from './model-usage.mts'
import { summarizeUsage } from './usage-summary.mts'
import type { Usage } from './usage.mts'

/** The selection bench snapshots cases as `bench` does and calls the real selection step. */
export type SelectionBenchDeps = BenchDeps & {
  skills: typeof listRuleSkills
  targets: typeof builtInTargets
  select: typeof selectSkills
}

export const defaultSelectionDeps: SelectionBenchDeps = {
  ...defaultBenchDeps,
  skills: listRuleSkills,
  targets: builtInTargets,
  select: selectSkills,
}

const isSelectable = (item: EvalCase): boolean =>
  item.expectedSkills !== undefined ||
  item.expectedTargets !== undefined ||
  item.unwantedTargets !== undefined

type Options = { out: string; cache: string; attempts: number; jobs: number }

const rawPath = (out: string, id: string, attempt: number) =>
  join(out, 'raw', id, `${attempt}.json`)

function positive(value: string, name: string): number {
  const count = Number(value)
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`--${name} must be a positive integer.`)
  return count
}

async function runAll(
  cases: EvalCase[],
  options: Options,
  deps: SelectionBenchDeps,
): Promise<void> {
  // One listing gives both the rule skills offered and the isolation settings, as in `review`.
  const listed = await deps.exec('claude', ['plugin', 'list', '--json'])
  const settings = pluginSettings(parsePluginList(listed, process.cwd()), DEFAULT_RULE_PLUGINS)
  const skills = deps.skills(parsePluginInstalls(listed), DEFAULT_RULE_PLUGINS)
  const targets = deps.targets().map(({ name, when }) => ({ name, when }))
  const tasks: Array<{ item: EvalCase; attempt: number; dir: string; text: SelectionText }> = []
  for (const item of cases) {
    deps.log(`snapshot ${item.id}`)
    const snapshot = await deps.prepare(item, options.cache, join(options.out, 'work'), deps.exec)
    const text = selectionText(snapshot, (path) => deps.readFile(path))
    for (let attempt = 1; attempt <= options.attempts; attempt += 1)
      tasks.push({ item, attempt, dir: snapshot.dir, text })
  }
  await pool(tasks, options.jobs, async ({ item, attempt, dir, text }) => {
    deps.log(`select ${item.id} ${attempt}`)
    const choice = await deps.select({
      ...text,
      skills,
      ...(targets.length === 0 ? {} : { targets }),
      settings,
      exec: deps.exec,
      cwd: dir,
    })
    deps.writeFile(rawPath(options.out, item.id, attempt), `${JSON.stringify(choice, null, 2)}\n`)
  })
}

const readChoice = (path: string, deps: BenchDeps): SkillChoice | undefined =>
  deps.exists(path) ? (JSON.parse(deps.readFile(path)) as SkillChoice) : undefined

/** Scores the saved attempts and writes `summary.json` and `summary.md`; returns the totals line. */
function scoreAll(cases: EvalCase[], options: Options, deps: BenchDeps): string {
  const scores: SelectionCaseScore[] = []
  const targetScores: TargetCaseScore[] = []
  const usages: Usage[] = []
  const runs: Array<Usage | null> = []
  for (const item of cases) {
    const choices = Array.from({ length: options.attempts }, (_, index) =>
      readChoice(rawPath(options.out, item.id, index + 1), deps),
    )
    for (const choice of choices) {
      runs.push(choice?.usage ?? null)
      if (choice?.usage) usages.push(choice.usage)
    }
    if (item.expectedSkills !== undefined) {
      scores.push(scoreSelectionCase(item.id, item.expectedSkills, choices, item.unwantedSkills))
    }
    if (item.expectedTargets !== undefined || item.unwantedTargets !== undefined) {
      const exp = item.expectedTargets ?? []
      const unw = item.unwantedTargets ?? []
      targetScores.push(scoreSelectionTargetCase(item.id, exp, unw, choices))
    }
  }
  const summary = summarizeSelection(scores)
  const targets = summarizeSelectionTargets(targetScores)
  const usage = summarizeUsage(usages)
  const models = summarizeByModel('selection', null, runs)
  const json = {
    summary,
    scores,
    ...(targets === null ? {} : { targets, targetScores }),
    models: [models],
    costUsd: usage.totalCostUsd,
  }
  deps.writeFile(join(options.out, 'summary.json'), `${JSON.stringify(json, null, 2)}\n`)
  const path = join(options.out, 'summary.md')
  deps.writeFile(
    path,
    `${renderSelection(scores, summary, usages, models, targetScores, targets)}\n`,
  )
  const { cases: total, attempts, hits, hitRate, meanSelected, errors, notRun } = summary
  return JSON.stringify({
    summary: path,
    cases: total,
    attempts,
    hits,
    hitRate,
    meanSelected,
    errors,
    notRun,
    ...(summary.unwanted === null ? {} : { unwanted: summary.unwanted }),
    ...(targets === null ? {} : { targets }),
    costUsd: usage.totalCostUsd,
  })
}

/**
 * `code-reviewer bench-selection`: run the Haiku skill-selection step `--attempts` times on each
 * case that declares `expectedSkills` or target expectations, and score the results.
 */
export async function runReviewSelectionBenchCli(
  args: string[],
  deps: SelectionBenchDeps = defaultSelectionDeps,
): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      cases: { type: 'string', multiple: true },
      out: { type: 'string' },
      cache: { type: 'string' },
      case: { type: 'string', multiple: true },
      attempts: { type: 'string' },
      jobs: { type: 'string' },
      'score-only': { type: 'boolean' },
    },
  })
  const files = values.cases ?? []
  if (files.length === 0 || values.out === undefined)
    throw new Error('bench-selection needs --cases and --out.')
  const ids = new Set(values.case ?? [])
  const cases = files
    .flatMap((file) => parseEvalCases(JSON.parse(deps.readFile(file)) as unknown, dirname(file)))
    .filter(isSelectable)
    .filter((item) => ids.size === 0 || ids.has(item.id))
  if (new Set(cases.map((item) => item.id)).size !== cases.length)
    throw new Error('bench-selection case ids must be unique across --cases files.')
  if (cases.length === 0)
    throw new Error('bench-selection found no cases with expectedSkills or target expectations.')
  const options: Options = {
    out: values.out,
    cache: values.cache ?? join(values.out, 'cache'),
    attempts: positive(values.attempts ?? '3', 'attempts'),
    jobs: positive(values.jobs ?? '3', 'jobs'),
  }
  if (values['score-only'] !== true) await runAll(cases, options, deps)
  process.stdout.write(`${scoreAll(cases, options, deps)}\n`)
  return 0
}

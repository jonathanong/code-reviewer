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
import { parseEvalCases, type EvalCase } from './cases.mts'
import { defaultBenchDeps, type BenchDeps } from './cli.mts'
import type { ExpectedSkill } from './skills-score.mts'
import { selectionText, type SelectionText } from './selection-input.mts'
import {
  renderSelection,
  scoreSelectionCase,
  summarizeSelection,
  type SelectionCaseScore,
} from './selection-score.mts'
import { summarizeByModel } from './model-usage.mts'
import { summarizeUsage } from './usage-summary.mts'
import type { Usage } from './usage.mts'

/** The selection bench snapshots cases as `bench` does and calls the real selection step. */
export type SelectionBenchDeps = BenchDeps & {
  skills: typeof listRuleSkills
  select: typeof selectSkills
}

export const defaultSelectionDeps: SelectionBenchDeps = {
  ...defaultBenchDeps,
  skills: listRuleSkills,
  select: selectSkills,
}

/** A case that declares the skills selection should name. */
type Selectable = EvalCase & { expectedSkills: ExpectedSkill[] }

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
  cases: Selectable[],
  options: Options,
  deps: SelectionBenchDeps,
): Promise<void> {
  // One listing gives both the rule skills offered and the isolation settings, as in `review`.
  const listed = await deps.exec('claude', ['plugin', 'list', '--json'])
  const settings = pluginSettings(parsePluginList(listed, process.cwd()), DEFAULT_RULE_PLUGINS)
  const skills = deps.skills(parsePluginInstalls(listed), DEFAULT_RULE_PLUGINS)
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
    const choice = await deps.select({ ...text, skills, settings, exec: deps.exec, cwd: dir })
    deps.writeFile(rawPath(options.out, item.id, attempt), `${JSON.stringify(choice, null, 2)}\n`)
  })
}

function readChoice(path: string, deps: BenchDeps): SkillChoice | undefined {
  return deps.exists(path) ? (JSON.parse(deps.readFile(path)) as SkillChoice) : undefined
}

/** Scores the saved attempts and writes `summary.json` and `summary.md`; returns the totals line. */
function scoreAll(cases: Selectable[], options: Options, deps: BenchDeps): string {
  const scores: SelectionCaseScore[] = []
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
    scores.push(scoreSelectionCase(item.id, item.expectedSkills, choices))
  }
  const summary = summarizeSelection(scores)
  const usage = summarizeUsage(usages)
  const models = summarizeByModel('selection', null, runs)
  const json = { summary, scores, models: [models], costUsd: usage.totalCostUsd }
  deps.writeFile(join(options.out, 'summary.json'), `${JSON.stringify(json, null, 2)}\n`)
  const path = join(options.out, 'summary.md')
  deps.writeFile(path, `${renderSelection(scores, summary, usages, models)}\n`)
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
    costUsd: usage.totalCostUsd,
  })
}

/**
 * `code-reviewer bench-selection`: run the Haiku skill-selection step `--attempts` times on each
 * case that declares `expectedSkills`, and score how often it names every expected skill.
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
    .filter((item): item is Selectable => item.expectedSkills !== undefined)
    .filter((item) => ids.size === 0 || ids.has(item.id))
  if (new Set(cases.map((item) => item.id)).size !== cases.length)
    throw new Error('bench-selection case ids must be unique across --cases files.')
  if (cases.length === 0) throw new Error('bench-selection found no cases with expectedSkills.')
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

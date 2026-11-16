import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import { PILLARS, type Pillar } from '../finding.mts'
import { casesForPillar, parseEvalCases, type EvalCase } from './cases.mts'
import { pool } from '../run/pool.mts'
import { judgeAll, type RawResult } from './judge-all.mts'
import { benchPlugins } from './plugin-settings.mts'
import { runPillar } from './runner.mts'
import { scoreAll, type Options } from './score-all.mts'
import { NO_RULES, stageCaseRules } from './rules.mts'
import { describeFailure } from './usage.mts'
import { defaultExec, prepareSnapshot, type Exec, type Snapshot } from './snapshot.mts'

export type BenchDeps = {
  exec: Exec
  readFile(path: string): string
  writeFile(path: string, text: string): void
  exists(path: string): boolean
  log(line: string): void
  prepare: typeof prepareSnapshot
}

/** The pillar bench also stages rule sources. */
export type PillarBenchDeps = BenchDeps & { stageRules: typeof stageCaseRules; cwd(): string }

export const defaultBenchDeps: BenchDeps = {
  exec: defaultExec,
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  },
  exists: existsSync,
  log: (line) => process.stderr.write(`${line}\n`),
  prepare: prepareSnapshot,
}

const defaultPillarDeps: PillarBenchDeps = {
  ...defaultBenchDeps,
  stageRules: stageCaseRules,
  cwd: () => process.cwd(),
}

function pickPillars(requested: string[], cases: readonly EvalCase[]): Pillar[] {
  if (requested.length > 0) {
    return requested.map((name) => {
      const pillar = PILLARS.find((candidate) => candidate === name)
      if (pillar === undefined) throw new Error(`Unknown pillar: ${name}`)
      return pillar
    })
  }
  const used = new Set(cases.flatMap((item) => item.expected.map((entry) => entry.pillar)))
  return PILLARS.filter((pillar) => used.has(pillar))
}

async function runAll(
  cases: EvalCase[],
  pillars: Pillar[],
  options: Options,
  deps: PillarBenchDeps,
): Promise<void> {
  const rawPath = (pillar: Pillar, id: string) => join(options.out, 'raw', pillar, `${id}.json`)
  if (options.scoreOnly) return
  const { labels: plugins, settings } = await benchPlugins(
    deps.exec,
    deps.cwd(),
    !options.noRules,
    (line) => deps.log(line),
  )
  const snapshots = new Map<string, Snapshot>()
  const digests = new Map<string, string>()
  for (const item of new Set(pillars.flatMap((pillar) => casesForPillar(cases, pillar)))) {
    deps.log(`snapshot ${item.id}`)
    const snapshot = await deps.prepare(
      item,
      join(options.out, 'cache'),
      join(options.out, 'work'),
      deps.exec,
    )
    snapshots.set(item.id, snapshot)
    // The digest keys a saved raw result to the rules it saw; control runs record `none`.
    digests.set(item.id, options.noRules ? NO_RULES : await deps.stageRules(item, snapshot))
  }
  const contractPath = join(options.prompts, '_contract.md')
  const contract = deps.exists(contractPath) ? deps.readFile(contractPath).trim() : ''
  const tasks = pillars.flatMap((pillar) => {
    const pillarPrompt = [contract, deps.readFile(join(options.prompts, `${pillar}.md`))]
      .filter((part) => part.length > 0)
      .join('\n\n')
    return casesForPillar(cases, pillar).map((item) => ({ pillar, pillarPrompt, item }))
  })
  await pool(tasks, options.jobs, async ({ pillar, pillarPrompt, item }) => {
    deps.log(`run ${pillar} ${item.id}`)
    const dir = (snapshots.get(item.id) as Snapshot).dir
    const seen = { rules: digests.get(item.id) as string, plugins }
    let result: RawResult
    try {
      const { model, maxTurns } = options
      const run = {
        pillar,
        pillarPrompt,
        model,
        maxTurns,
        skills: !options.noRules,
        ...(settings === undefined ? {} : { settings }),
      }
      const { findings, skills, usage } = await runPillar(item, dir, run, deps.exec)
      result = { findings, skills, skillTool: !options.noRules, usage, ...seen }
    } catch (error) {
      const { message, usage } = describeFailure(error)
      result = { error: message, ...(usage === null ? {} : { usage }), ...seen }
    }
    deps.writeFile(rawPath(pillar, item.id), `${JSON.stringify(result, null, 2)}\n`)
  })
}

/** `code-reviewer bench`: run pillar prompts over labeled cases and score them. */
export async function runReviewBenchCli(
  args: string[],
  deps: PillarBenchDeps = defaultPillarDeps,
): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      cases: { type: 'string' },
      prompts: { type: 'string' },
      out: { type: 'string' },
      pillar: { type: 'string', multiple: true },
      case: { type: 'string', multiple: true },
      model: { type: 'string' },
      'max-turns': { type: 'string' },
      jobs: { type: 'string' },
      'score-only': { type: 'boolean' },
      judge: { type: 'string' },
      'no-rules': { type: 'boolean' },
      baseline: { type: 'string' },
    },
  })
  if (values.cases === undefined || values.out === undefined)
    throw new Error('bench needs --cases and --out.')
  if (values['score-only'] !== true && values.prompts === undefined)
    throw new Error('bench needs --prompts.')
  const ids = new Set(values.case ?? [])
  const cases = parseEvalCases(
    JSON.parse(deps.readFile(values.cases)) as unknown,
    dirname(values.cases),
  ).filter((item) => ids.size === 0 || ids.has(item.id))
  const pillars = pickPillars(values.pillar ?? [], cases)
  const options: Options = {
    out: values.out,
    prompts: values.prompts ?? '',
    model: values.model ?? 'sonnet',
    maxTurns: Number(values['max-turns'] ?? '40'),
    jobs: Number(values.jobs ?? '3'),
    scoreOnly: values['score-only'] === true,
    judge: values.judge,
    noRules: values['no-rules'] === true,
    ...(values.baseline === undefined ? {} : { baseline: values.baseline }),
  }
  await runAll(cases, pillars, options, deps)
  if (options.judge !== undefined) {
    await judgeAll(
      cases,
      pillars,
      { out: options.out, model: options.judge, jobs: options.jobs },
      deps,
    )
  }
  process.stdout.write(`${scoreAll(cases, pillars, options, deps)}\n`)
  return 0
}

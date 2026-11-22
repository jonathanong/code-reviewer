import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'

import { PILLARS, type Pillar } from '../pillar-name.mts'
import { defaultSelectStep, type SelectStep } from './case-selection.mts'
import { parseEvalCases, type EvalCase } from './cases.mts'
import { parseExcerpts } from './excerpts.mts'
import { otherEffort, parseBenchEffort } from './effort-option.mts'
import { assertPillarHarness, otherHarness } from './harness-option.mts'
import { judgeAll } from './judge-all.mts'
import { shellPrefixes } from './shell-option.mts'
import { runAll } from './run-all.mts'
import { scoreAll, type Options } from './score-all.mts'
import { stageCaseRules } from './rules.mts'
import { defaultExec, prepareSnapshot, type Exec } from './snapshot.mts'

export type BenchDeps = {
  exec: Exec
  readFile(path: string): string
  writeFile(path: string, text: string): void
  exists(path: string): boolean
  log(line: string): void
  prepare: typeof prepareSnapshot
}

/** The pillar bench also stages rule sources. */
export type PillarBenchDeps = BenchDeps & {
  stageRules: typeof stageCaseRules
  cwd(): string
  selection: SelectStep
}

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
  selection: defaultSelectStep,
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

function assertLoadsOnly(values: {
  pillar?: string[]
  harness?: unknown
  [flag: string]: unknown
}): void {
  if (values.pillar === undefined) throw new Error('bench --loads-only needs --pillar.')
  for (const flag of ['judge', 'baseline', 'no-rules'])
    if (values[flag] !== undefined)
      throw new Error(`bench --loads-only cannot be combined with --${flag}.`)
  if (otherHarness(values.harness as string | undefined) !== undefined)
    throw new Error(
      'bench --loads-only needs --harness claude: other harnesses report no loaded skills.',
    )
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
      harness: { type: 'string' },
      effort: { type: 'string' },
      'reads-outside-checkout': { type: 'boolean' },
      shell: { type: 'string', multiple: true },
      'max-turns': { type: 'string' },
      jobs: { type: 'string' },
      'score-only': { type: 'boolean' },
      judge: { type: 'string' },
      'no-rules': { type: 'boolean' },
      select: { type: 'boolean' },
      'select-all-pillars': { type: 'boolean' },
      excerpts: { type: 'string' },
      baseline: { type: 'string' },
      'loads-only': { type: 'boolean' },
    },
  })
  if (values['loads-only'] === true) assertLoadsOnly(values)
  const shell = shellPrefixes(values)
  if (values['select-all-pillars'] === true && values.select !== true)
    throw new Error('bench --select-all-pillars needs --select.')
  if (values.cases === undefined || values.out === undefined)
    throw new Error('bench needs --cases and --out.')
  if (values['score-only'] !== true && values.prompts === undefined)
    throw new Error('bench needs --prompts.')
  const ids = new Set(values.case ?? [])
  const cases = parseEvalCases(
    JSON.parse(deps.readFile(values.cases)) as unknown,
    dirname(values.cases),
  ).filter((item) => ids.size === 0 || ids.has(item.id))
  const effort = otherEffort(parseBenchEffort(values.effort, values['loads-only']))
  const pillars = pickPillars(values.pillar ?? [], cases)
  assertPillarHarness(values, pillars, values['no-rules'] !== true)
  const excerpts =
    values.excerpts === undefined
      ? {}
      : {
          excerpts: parseExcerpts(
            values.excerpts,
            values.select === true,
            values['no-rules'] === true,
          ),
        }
  const options: Options = {
    out: values.out,
    prompts: values.prompts ?? '',
    model: values.model ?? 'sonnet',
    maxTurns: Number(values['max-turns'] ?? '40'),
    jobs: Number(values.jobs ?? '3'),
    scoreOnly: values['score-only'] === true,
    judge: values.judge,
    noRules: values['no-rules'] === true,
    select: values.select === true,
    ...(values['select-all-pillars'] === true ? { selectAllPillars: true } : {}),
    ...(values['loads-only'] === true ? { loadsOnly: true } : {}),
    ...(otherHarness(values.harness) === undefined ? {} : { harness: values.harness }),
    ...(values['reads-outside-checkout'] === true ? { readsOutsideCheckout: true } : {}),
    ...(shell.length === 0 ? {} : { shell }),
    ...(effort === undefined ? {} : { effort }),
    ...excerpts,
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

import { join } from 'node:path'

import { describeStepFailure } from '../../harness/runner.mts'
import type { Pillar } from '../pillar-name.mts'
import { caseSelector } from './case-selection.mts'
import type { EvalCase } from './cases.mts'
import { benchCases } from './loads-only.mts'
import type { PillarBenchDeps } from './cli.mts'
import { pool } from '../run/pool.mts'
import { excerptWriter } from './excerpts.mts'
import type { RawResult } from './judge-all.mts'
import { benchPlugins } from './plugin-settings.mts'
import { runPillar } from './runner.mts'
import type { Options } from './score-all.mts'
import { NO_RULES } from './rules.mts'
import type { Snapshot } from './snapshot.mts'

/** Prepares every case once, then runs each pillar over its cases and saves the raw results. */
export async function runAll(
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
  // `--select` adds review's skill-selection step, so a pillar is told which skills to load.
  const select =
    options.select && !options.noRules
      ? await caseSelector(options.out, settings, deps, deps.selection)
      : undefined
  const selected = new Map<string, string[]>()
  const writeExcerpts =
    options.excerpts === undefined ? undefined : await excerptWriter(options.excerpts, deps)
  for (const item of new Set(
    pillars.flatMap((pillar) => benchCases(cases, pillar, options.loadsOnly)),
  )) {
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
    if (select !== undefined) {
      const chosen = await select(item, snapshot)
      selected.set(item.id, chosen)
      await writeExcerpts?.(snapshot.dir, chosen)
    }
  }
  const contractPath = join(options.prompts, '_contract.md')
  const contract = deps.exists(contractPath) ? deps.readFile(contractPath).trim() : ''
  const tasks = pillars.flatMap((pillar) => {
    const pillarPrompt = [contract, deps.readFile(join(options.prompts, `${pillar}.md`))]
      .filter((part) => part.length > 0)
      .join('\n\n')
    return benchCases(cases, pillar, options.loadsOnly).map((item) => ({
      pillar,
      pillarPrompt,
      item,
    }))
  })
  await pool(tasks, options.jobs, async ({ pillar, pillarPrompt, item }) => {
    deps.log(`run ${pillar} ${item.id}`)
    const dir = (snapshots.get(item.id) as Snapshot).dir
    const chosen = selected.get(item.id)
    const seen = {
      rules: digests.get(item.id) as string,
      plugins,
      ...(chosen === undefined ? {} : { selected: chosen }),
      ...(options.excerpts === undefined ? {} : { excerpts: options.excerpts }),
    }
    const ranOn = options.harness === undefined ? {} : { harness: options.harness }
    const shelled = options.shell === undefined ? {} : { shell: options.shell }
    let result: RawResult
    try {
      const { model, maxTurns } = options
      const run = {
        pillar,
        pillarPrompt,
        model,
        maxTurns,
        skills: !options.noRules,
        ...(options.harness === undefined ? {} : { harness: options.harness }),
        ...(options.readsOutsideCheckout === true ? { readsOutsideCheckout: true } : {}),
        ...(options.shell === undefined ? {} : { shell: options.shell }),
        ...(options.excerpts === undefined ? {} : { excerpts: options.excerpts }),
        ...(chosen === undefined ? {} : { selected: chosen }),
        ...(options.selectAllPillars === true ? { selectAllPillars: true } : {}),
        ...(settings === undefined ? {} : { settings }),
      }
      const { findings, skills, usage } = await runPillar(item, dir, run, deps.exec)
      result = {
        findings,
        skills,
        skillTool: !options.noRules,
        usage,
        ...seen,
        ...ranOn,
        ...shelled,
      }
    } catch (error) {
      const { message, usage } = describeStepFailure(error)
      result = {
        error: message,
        ...(usage === null ? {} : { usage }),
        ...seen,
        ...ranOn,
        ...shelled,
      }
    }
    deps.writeFile(rawPath(pillar, item.id), `${JSON.stringify(result, null, 2)}\n`)
  })
}

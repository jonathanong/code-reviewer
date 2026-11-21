import { describeStepFailure } from '../../harness/runner.mts'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import type { Finding, Pillar } from '../finding.mts'
import { pool } from '../run/pool.mts'
import { benchPlugins } from './plugin-settings.mts'
import { casesForPillar, type EvalCase, type ExpectedFinding } from './cases.mts'
import { judgeFindings, type Assignment, type Judged } from './judge.mts'
import type { Exec } from './snapshot.mts'
import type { Usage } from './usage.mts'

/**
 * `rules` is the digest of the staged rule sources (or `none`) the run saw; `plugins` lists the
 * enabled Claude Code plugins and versions whose skills it could load.
 */
export type RawResult =
  | {
      findings: Finding[]
      judged?: Judged
      rules?: string
      plugins?: string[]
      /** Distinct skills the run loaded through the Skill tool; absent in older results. */
      skills?: string[]
      /** False for a control run with no Skill tool; absent in older results. */
      skillTool?: boolean
      /** Skills `--select` told the run to load; absent without it. */
      selected?: string[]
      /** Cost, turns, and tokens of the run; absent in older results. */
      usage?: Usage
    }
  | { error: string; rules?: string; plugins?: string[]; selected?: string[]; usage?: Usage }

export type JudgeDeps = {
  exec: Exec
  readFile(path: string): string
  writeFile(path: string, text: string): void
  exists(path: string): boolean
  log(line: string): void
}

/** Fingerprints what a judgement indexes, so edited claims or re-run findings invalidate it. */
export function judgeInputs(
  expected: readonly ExpectedFinding[],
  findings: readonly Finding[],
): string {
  return createHash('sha256').update(JSON.stringify({ expected, findings })).digest('hex')
}

/** The cached assignment when it was made by `model` for exactly these inputs, else undefined. */
export function currentAssignment(
  raw: { findings: Finding[]; judged?: Judged },
  expected: readonly ExpectedFinding[],
  model: string,
): Assignment | undefined {
  const judged = raw.judged
  if (judged?.model !== model || judged.inputs !== judgeInputs(expected, raw.findings))
    return undefined
  return judged.assignment
}

/** Adds a judge assignment to every raw result that lacks a current one from this model. */
export async function judgeAll(
  cases: readonly EvalCase[],
  pillars: readonly Pillar[],
  options: { out: string; model: string; jobs: number },
  deps: JudgeDeps,
): Promise<void> {
  const { noPlugins } = await benchPlugins(deps.exec, process.cwd(), false, (line) =>
    deps.log(line),
  )
  const tasks = pillars.flatMap((pillar) =>
    casesForPillar(cases, pillar).map((item) => ({ pillar, item })),
  )
  await pool(tasks, options.jobs, async ({ pillar, item }) => {
    const path = join(options.out, 'raw', pillar, `${item.id}.json`)
    if (!deps.exists(path)) return
    const raw = JSON.parse(deps.readFile(path)) as RawResult
    const expected = item.expected.filter((entry) => entry.pillar === pillar)
    if ('error' in raw || currentAssignment(raw, expected, options.model) !== undefined) return
    deps.log(`judge ${pillar} ${item.id}`)
    try {
      const assignment = await judgeFindings(
        expected,
        raw.findings,
        options.model,
        deps.exec,
        noPlugins,
      )
      const judged: Judged = {
        model: options.model,
        inputs: judgeInputs(expected, raw.findings),
        assignment,
      }
      deps.writeFile(path, `${JSON.stringify({ ...raw, judged }, null, 2)}\n`)
    } catch (error) {
      deps.log(`judge ${pillar} ${item.id} failed: ${describeStepFailure(error).message}`)
    }
  })
}

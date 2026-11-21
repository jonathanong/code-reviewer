import type { Exec } from '../review/benchmark/exec.mts'
import { pool } from '../review/run/pool.mts'
import { defaultModelsIo, type ModelsIo } from './io.mts'
import { listModels } from './list.mts'
import { renderTable } from './render.mts'
import { runProbe } from './run-probe.mts'
import { rank, summarize } from './summarize.mts'
import type { ModelsReport, RunRecord } from './types.mts'

export const SUPPORTED_HARNESSES = ['opencode']

export type ModelsValues = {
  harness?: string | undefined
  free?: boolean | undefined
  model?: string[] | undefined
  probes?: string | undefined
  jobs?: string | undefined
  out?: string | undefined
}

function positive(flag: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const count = Number(value)
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`--${flag} must be a positive integer.`)
  return count
}

/**
 * `code-reviewer models`: probes each model the harness offers with synthetic files, scores the
 * replies without a judge model, prints one JSON report on stdout and a table on stderr.
 */
export async function modelsCommand(
  values: ModelsValues,
  exec: Exec,
  io: ModelsIo = defaultModelsIo(),
): Promise<number> {
  const harness = values.harness
  if (harness === undefined || !SUPPORTED_HARNESSES.includes(harness)) {
    throw new Error(`models needs --harness ${SUPPORTED_HARNESSES.join(' or ')}.`)
  }
  const repeats = positive('probes', values.probes, 1)
  const jobs = positive('jobs', values.jobs, 2)
  const ids = await listModels(exec, { free: values.free === true, explicit: values.model ?? [] })
  if (ids.length === 0) throw new Error('no models to probe.')
  const records = new Map<string, RunRecord[]>(ids.map((id) => [id, []]))
  const probes = io.probes()
  const tasks = ids.flatMap((id) =>
    probes.flatMap((probe) => Array.from({ length: repeats }, () => ({ id, probe }))),
  )
  await pool(tasks, jobs, async ({ id, probe }) => {
    records.get(id)!.push(await runProbe(id, probe, io, exec))
  })
  const report: ModelsReport = {
    harness,
    models: rank(ids.map((id) => summarize(id, records.get(id)!))),
  }
  const json = `${JSON.stringify(report, null, 2)}\n`
  const table = renderTable(report)
  if (values.out !== undefined) {
    await io.writeOut(values.out, 'models.json', json)
    await io.writeOut(values.out, 'models.md', table)
  }
  process.stderr.write(table)
  process.stdout.write(json)
  return 0
}

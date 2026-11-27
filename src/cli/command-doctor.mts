import { createDoctorIo } from '../doctor/io.mts'
import { renderLines, runDoctor } from '../doctor/run.mts'
import type { DoctorFlags } from '../doctor/types.mts'
import type { ReviewDeps } from './deps.mts'

type DoctorValues = {
  repo?: string[] | undefined
  owner?: string | undefined
  offline?: boolean | undefined
  clones?: string | undefined
}

function flagsFrom(values: DoctorValues): DoctorFlags {
  const [repo, extra] = values.repo ?? []
  if (extra !== undefined) throw new Error('give --repo at most once.')
  if (repo !== undefined && values.owner !== undefined) {
    throw new Error('give --repo or --owner, not both.')
  }
  if (repo !== undefined && !/^[^/\s]+\/[^/\s]+$/u.test(repo)) {
    throw new Error('--repo must be owner/name.')
  }
  return {
    ...(repo === undefined ? {} : { repo }),
    ...(values.owner === undefined ? {} : { owner: values.owner }),
    ...(values.clones === undefined ? {} : { clones: values.clones }),
    offline: values.offline === true,
  }
}

/** Reads and changes nothing: human lines on stderr, one JSON line on stdout, exit 1 on a fail. */
export async function doctorCommand(
  values: DoctorValues,
  deps: ReviewDeps,
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const result = await runDoctor({ io: createDoctorIo(deps, env), flags: flagsFrom(values) })
  process.stderr.write(`${renderLines(result).join('\n')}\n`)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result.fail === 0 ? 0 : 1
}

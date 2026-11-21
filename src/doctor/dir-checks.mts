import { dirname } from 'node:path'

import { settingsProblems } from '../review/settings.mts'
import { reasonOf } from './pool.mts'
import type { Check, Context, DoctorIo } from './types.mts'

/** The nearest ancestor of `path` that exists; stops at the root. */
function nearestExisting(io: DoctorIo, path: string): string {
  let current = path
  while (io.fs.mtimeMs(current) === undefined && dirname(current) !== current) {
    current = dirname(current)
  }
  return current
}

/** A directory that must be writable. A missing one is fine when its nearest parent is writable. */
function writableDir(io: DoctorIo, name: string, path: string): Check {
  if (io.fs.mtimeMs(path) !== undefined) {
    if (!io.fs.isDirectory(path)) {
      return { name, status: 'fail', detail: `${path} is not a directory`, fix: `rm ${path}` }
    }
    return io.fs.writable(path)
      ? { name, status: 'ok', detail: `${path} exists and is writable` }
      : { name, status: 'fail', detail: `${path} is not writable`, fix: `chmod u+w ${path}` }
  }
  const parent = nearestExisting(io, path)
  return io.fs.writable(parent)
    ? { name, status: 'ok', detail: `${path} does not exist yet; ${parent} is writable` }
    : {
        name,
        status: 'fail',
        detail: `${path} does not exist and ${parent} is not writable`,
        fix: `mkdir -p ${path}`,
      }
}

export function dirChecks({ io }: Context): Check[] {
  return [writableDir(io, 'tracker-dir', io.stateDir), writableDir(io, 'tmp-dir', io.tmpDir)]
}

/** Every machine config file parses; for `--repo` or `--owner` the problems of that scope. */
export function configCheck({ io, flags }: Context): Check {
  const name = 'machine-config'
  try {
    const configs = io.configs()
    const owner = flags.repo?.split('/')[0] ?? flags.owner
    const problems = owner === undefined ? configs.problems : settingsProblems(configs, owner)
    if (problems.length === 0) {
      return { name, status: 'ok', detail: `config under ${io.configDir} has no problems` }
    }
    return {
      name,
      status: 'fail',
      detail: problems.join('; '),
      fix: `edit the file each problem names under ${io.configDir}`,
    }
  } catch (error) {
    return {
      name,
      status: 'fail',
      detail: `cannot read ${io.configDir}: ${reasonOf(error)}`,
      fix: `check that ${io.configDir} is a readable directory`,
    }
  }
}

export async function cloneCheck({ io, flags }: Context): Promise<Check> {
  const name = 'clone-root'
  const root = io.env.CODE_REVIEWER_CLONE_ROOT
  if (root === undefined || root === '') {
    return { name, status: 'ok', detail: 'CODE_REVIEWER_CLONE_ROOT is not set (optional)' }
  }
  if (io.fs.mtimeMs(root) === undefined || !io.fs.isDirectory(root)) {
    return {
      name,
      status: 'warn',
      detail: `CODE_REVIEWER_CLONE_ROOT ${root} is not a directory`,
      fix: `mkdir -p ${root}, or unset CODE_REVIEWER_CLONE_ROOT`,
    }
  }
  if (flags.repo === undefined) return { name, status: 'ok', detail: `${root} exists` }
  try {
    const clone = await io.findClone(root, flags.repo)
    return clone === undefined
      ? {
          name,
          status: 'ok',
          detail: `${root} exists; no clone of ${flags.repo} (a checkout is made per run)`,
        }
      : { name, status: 'ok', detail: `${flags.repo} is cloned at ${clone}` }
  } catch (error) {
    return {
      name,
      status: 'warn',
      detail: `could not search ${root} for ${flags.repo}: ${reasonOf(error)}`,
      fix: `check the clones under ${root}`,
    }
  }
}

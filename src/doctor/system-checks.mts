import { missingWhy, PROBE_TIMEOUT_MS, probeBinary } from './probe.mts'
import { reasonOf } from './pool.mts'
import type { Check, Context, DoctorFlags, DoctorIo } from './types.mts'

/** The smallest Node version a range like `>=24` or `>=24.1` allows; undefined when not that shape. */
function minimum(range: string): [number, number] | undefined {
  const match = /^>=\s*(\d+)(?:\.(\d+))?/u.exec(range.trim())
  return match === null ? undefined : [Number(match[1]), Number(match[2] ?? 0)]
}

export function nodeCheck({ io }: Context): Check {
  const name = 'node'
  const min = minimum(io.nodeRange)
  if (min === undefined) {
    return { name, status: 'warn', detail: `cannot read the engines range "${io.nodeRange}"` }
  }
  const [major = 0, minor = 0] = io.nodeVersion.split('.').map(Number)
  if (major > min[0] || (major === min[0] && minor >= min[1])) {
    return { name, status: 'ok', detail: `Node ${io.nodeVersion} satisfies ${io.nodeRange}` }
  }
  return {
    name,
    status: 'fail',
    detail: `Node ${io.nodeVersion} is older than ${io.nodeRange}`,
    fix: `install Node ${min[0]} or newer and put it first on PATH`,
  }
}

const INSTALL = {
  git: 'install git (https://git-scm.com/downloads) and put it on PATH',
  gh: 'install the GitHub CLI (https://cli.github.com) and put it on PATH',
} as const

export async function binaryCheck(io: DoctorIo, binary: 'git' | 'gh'): Promise<Check> {
  const found = await probeBinary(io, binary)
  if (found.found) return { name: binary, status: 'ok', detail: found.version }
  return {
    name: binary,
    status: 'fail',
    detail: `${binary} ${missingWhy(found)}`,
    fix: INSTALL[binary],
  }
}

/** The GitHub App config: absent is fine (the local login is used); present must parse. */
function appCheck(io: DoctorIo): { check: Check; configured: boolean } {
  const name = 'github-app'
  try {
    const app = io.loadApp()
    if (app === undefined) {
      const detail = 'no App configured; the local gh login is used'
      return { check: { name, status: 'ok', detail }, configured: false }
    }
    const detail = `App config parses (source ${app.source})`
    return { check: { name, status: 'ok', detail }, configured: true }
  } catch (error) {
    const check: Check = {
      name,
      status: 'fail',
      detail: reasonOf(error),
      fix: 'correct the App config named above, or remove it to use the local gh login',
    }
    return { check, configured: false }
  }
}

/** Whether `gh` is logged in. Only the exit status is read, so no token reaches the output. */
async function loginCheck(io: DoctorIo, appUsed: boolean): Promise<Check> {
  const name = 'gh-login'
  if (appUsed) return { name, status: 'ok', detail: 'not needed; calls use the GitHub App' }
  try {
    await io.exec('gh', ['auth', 'status'], { timeoutMs: PROBE_TIMEOUT_MS })
    return { name, status: 'ok', detail: 'gh is logged in' }
  } catch {
    return {
      name,
      status: 'fail',
      detail: 'gh is not logged in, or could not be asked',
      fix: 'gh auth login',
    }
  }
}

/** For a configured App and an owner in scope: whether the App is installed there. */
async function installCheck(io: DoctorIo, flags: DoctorFlags): Promise<Check | undefined> {
  const [owner = '', name] = flags.repo?.split('/') ?? [flags.owner]
  if (owner === '') return undefined
  const check = 'github-app-installation'
  try {
    if ((await io.authModeFor(owner, name)) === 'app') {
      return { name: check, status: 'ok', detail: `the App is installed for ${owner}` }
    }
    return {
      name: check,
      status: 'warn',
      detail: `the App is not installed for ${owner}; calls for it use the gh login, and reviews post as that login`,
      fix: `install the App on ${owner} to review as the App`,
    }
  } catch (error) {
    return { name: check, status: 'fail', detail: reasonOf(error) }
  }
}

export async function authChecks({ io, flags }: Context): Promise<Check[]> {
  const { check, configured } = appCheck(io)
  const installed = configured ? await installCheck(io, flags) : undefined
  const appUsed = configured && installed?.status !== 'warn'
  return [check, ...(installed === undefined ? [] : [installed]), await loginCheck(io, appUsed)]
}

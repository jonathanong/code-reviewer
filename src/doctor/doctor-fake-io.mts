import { vi } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import { NO_CONFIGS } from '../review/rules/config.mts'
import type { DoctorFs, DoctorIo } from './types.mts'

export const NOW = new Date('2026-03-01T00:00:00Z')
export const DAY = 86_400_000

type Answer = string | Error

export type FakeOptions = {
  /** Keyed by `command arg arg`; an Error rejects, a string is stdout. Unlisted calls reject with ENOENT. */
  exec?: Record<string, Answer>
  files?: Record<string, string>
  /** Directories and their entries. */
  dirs?: Record<string, string[]>
  mtimes?: Record<string, number>
  unwritable?: string[]
  env?: Record<string, string>
  io?: Partial<DoctorIo>
}

export function notFound(command: string): ExecError {
  return new ExecError(`${command} not found`, 'ENOENT', '', new Error('spawn'))
}

/** The listing `claude plugin list --json` prints for the given user-scope plugins. */
export function listing(
  ...plugins: Array<{ id: string; version?: string; sha?: string; installPath?: string }>
): string {
  return JSON.stringify(
    plugins.map(({ sha, ...plugin }) => ({
      scope: 'user',
      enabled: true,
      installPath: `/plugins/${plugin.id.split('@')[0]}`,
      ...(sha === undefined ? {} : { gitCommitSha: sha }),
      ...plugin,
    })),
  )
}

export function fakeIo(options: FakeOptions = {}) {
  const exec = vi.fn(async (command: string, args: string[], opts?: { timeoutMs?: number }) => {
    void opts
    const answer = options.exec?.[[command, ...args].join(' ')]
    if (answer === undefined) throw notFound(command)
    if (answer instanceof Error) throw answer
    return answer
  })
  const dirs = options.dirs ?? {}
  const files = options.files ?? {}
  const known = (path: string) => path in dirs || path in files || path in (options.mtimes ?? {})
  const fs: DoctorFs = {
    mtimeMs: (path) => options.mtimes?.[path] ?? (known(path) ? NOW.getTime() : undefined),
    list: (path) => dirs[path],
    readText: (path) => files[path],
    isDirectory: (path) => path in dirs,
    writable: (path) => !(options.unwritable ?? []).includes(path),
  }
  const io: DoctorIo = {
    env: options.env ?? {},
    now: () => NOW,
    nodeVersion: '24.1.0',
    nodeRange: '>=24',
    exec,
    fs,
    loadApp: () => undefined,
    authModeFor: async () => 'app',
    configs: () => NO_CONFIGS,
    configDir: '/cfg/repos',
    stateDir: '/state/code-reviewer',
    tmpDir: '/tmp',
    claudeHome: '/home/.claude',
    findClone: async () => undefined,
    ...options.io,
  }
  return { io, exec }
}

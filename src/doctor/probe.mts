import { ExecError } from '../review/benchmark/exec.mts'
import type { DoctorIo } from './types.mts'

/** Bound on any `--version` or auth probe. */
export const PROBE_TIMEOUT_MS = 5_000

export type Probe =
  | { found: true; version: string }
  | { found: false; reason: 'not-on-path' | 'failed' }

/** Runs `<binary> --version`: whether it is on PATH and what it prints. */
export async function probeBinary(io: DoctorIo, binary: string): Promise<Probe> {
  try {
    const out = await io.exec(binary, ['--version'], { timeoutMs: PROBE_TIMEOUT_MS })
    return { found: true, version: out.trim().split('\n')[0] as string }
  } catch (error) {
    const missing = error instanceof ExecError && error.code === 'ENOENT'
    return { found: false, reason: missing ? 'not-on-path' : 'failed' }
  }
}

export function missingWhy(found: { reason: 'not-on-path' | 'failed' }): string {
  return found.reason === 'failed' ? 'did not run' : 'is not on PATH'
}

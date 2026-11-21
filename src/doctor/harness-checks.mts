import { harness as claude } from '../harness/claude.mts'
import { harness as codex } from '../harness/codex.mts'
import { harness as grok } from '../harness/grok.mts'
import { missingWhy, probeBinary } from './probe.mts'
import type { Check, DoctorIo } from './types.mts'

/** The adapters in `src/harness/`; each runs the binary named like itself. */
const ADAPTERS = [claude, grok, codex]

export function harnessChecks(io: DoctorIo): Promise<Check[]> {
  return Promise.all(
    ADAPTERS.map(async ({ name }): Promise<Check> => {
      const found = await probeBinary(io, name)
      const check = `harness:${name}`
      if (found.found) return { name: check, status: 'ok', detail: found.version }
      if (name !== 'claude') {
        return { name: check, status: 'ok', detail: `${name} ${missingWhy(found)} (optional)` }
      }
      return {
        name: check,
        status: 'fail',
        detail: `${name} ${missingWhy(found)}`,
        fix: 'install Claude Code (https://claude.com/claude-code) and put claude on PATH',
      }
    }),
  )
}

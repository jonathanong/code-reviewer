import { vi } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import type { ModelsIo } from './io.mts'
import { loadProbes } from './probes.mts'
import type { Probe } from './types.mts'

const probes = loadProbes()

/** The probe whose first file was staged under `cwd` by the fake stage. */
export const probeAt = (cwd: string): Probe =>
  probes.find((probe) => `/stage/${probe.files[0]!.path}` === cwd)!

const event = (body: object) => JSON.stringify(body)

/** OpenCode's `--format json` output for a run that finished with `reply` as its text. */
export function opencodeOutput(reply: string): string {
  const tokens = { input: 100, output: 20, cache: { read: 0, write: 0 } }
  return [
    event({ type: 'step_start' }),
    event({ type: 'text', part: { type: 'text', text: reply } }),
    event({ type: 'step_finish', part: { type: 'step-finish', tokens, cost: 0.5 } }),
  ].join('\n')
}

export const hitReply = (probe: Probe, extra: object[] = []): string =>
  JSON.stringify({ findings: [{ ...probe.planted, title: 'bug' }, ...extra] })

export const errorOutput = (message: string): string =>
  event({ type: 'error', error: { data: { message } } })

/** An exec that answers `opencode models` with `listing` and each run with `answer(model, cwd)`. */
export function fakeExec(listing: string, answer: (model: string, cwd: string) => string) {
  return vi.fn(async (_command: string, args: string[], options?: { cwd?: string }) => {
    if (args[0] === 'models') return listing
    const result = answer(args[args.indexOf('-m') + 1]!, options?.cwd ?? '')
    if (result.startsWith('{"type":"error"')) {
      throw new ExecError('opencode exited with 1', 1, result, undefined)
    }
    return result
  })
}

/** In-memory IO: a stage directory per probe, a clock that moves one second per read. */
export function fakeIo() {
  let clock = 0
  const removed: string[] = []
  const written = new Map<string, string>()
  const io: ModelsIo = {
    probes: () => probes,
    stage: async (files) => ({
      dir: `/stage/${files[0]!.path}`,
      remove: async () => {
        removed.push(files[0]!.path)
      },
    }),
    now: () => (clock += 1000),
    writeOut: async (dir, name, text) => {
      written.set(`${dir}/${name}`, text)
    },
  }
  return { io, removed, written }
}

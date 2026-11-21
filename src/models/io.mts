import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { loadProbes } from './probes.mts'
import type { Probe, ProbeFile } from './types.mts'

/** A staged probe tree; `remove` deletes it. */
export type Staged = { dir: string; remove(): Promise<void> }

/** The machine around the command, replaceable in a test. */
export type ModelsIo = {
  probes(): Probe[]
  stage(files: readonly ProbeFile[]): Promise<Staged>
  /** Milliseconds from any fixed point. */
  now(): number
  /** Writes `text` to `dir/name`, creating `dir`. */
  writeOut(dir: string, name: string, text: string): Promise<void>
}

export function defaultModelsIo(): ModelsIo {
  return {
    probes: loadProbes,
    stage: async (files) => {
      const dir = await fs.mkdtemp(join(tmpdir(), 'code-reviewer-probe-'))
      for (const file of files) {
        const target = join(dir, file.path)
        await fs.mkdir(dirname(target), { recursive: true })
        await fs.writeFile(target, file.content)
      }
      return { dir, remove: () => fs.rm(dir, { recursive: true, force: true }) }
    },
    now: () => performance.now(),
    writeOut: async (dir, name, text) => {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(join(dir, name), text)
    },
  }
}

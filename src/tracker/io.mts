import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { TrackerIo } from './types.mts'

/**
 * The tracker's state directory: `CODE_REVIEWER_STATE_DIR`, else `code-reviewer` under the XDG
 * state home. State is machine-local history, so it stays out of the config directory.
 */
export function stateHome(env: Record<string, string | undefined>): string {
  return (
    env.CODE_REVIEWER_STATE_DIR ||
    join(env.XDG_STATE_HOME || join(env.HOME || homedir(), '.local', 'state'), 'code-reviewer')
  )
}

export function createTrackerIo(env: Record<string, string | undefined>): TrackerIo {
  return {
    dir: stateHome(env),
    read: (path) => {
      try {
        return readFileSync(path, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    // One appendFileSync is one write on an O_APPEND descriptor, so concurrent runs interleave whole lines.
    append: (path, text) => {
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(path, text)
    },
    // Written beside the target and renamed over it, so a reader never sees half a file.
    write: (path, text) => {
      mkdirSync(dirname(path), { recursive: true })
      const temp = `${path}.${process.pid}.tmp`
      writeFileSync(temp, text)
      renameSync(temp, path)
    },
    now: () => new Date(),
  }
}

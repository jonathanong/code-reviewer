import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ReviewDeps } from '../cli/deps.mts'
import { loadAppConfig, runGit } from '../gh-cli/index.mts'
import { pluginRoot } from '../plugin-root.mts'
import { machineConfigDir } from '../review/rules/config.mts'
import { findClone } from '../run/tree.mts'
import { stateHome } from '../tracker/io.mts'
import type { DoctorFs, DoctorIo } from './types.mts'

const absent = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

/** Reads only; `writable` asks the file system with access(2) and creates nothing. */
export const realFs: DoctorFs = {
  mtimeMs(path) {
    try {
      return statSync(path).mtimeMs
    } catch (error) {
      if (absent(error)) return undefined
      throw error
    }
  },
  list(path) {
    try {
      return readdirSync(path)
    } catch (error) {
      if (absent(error)) return undefined
      throw error
    }
  },
  readText(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch (error) {
      if (absent(error)) return undefined
      throw error
    }
  },
  isDirectory: (path) => statSync(path).isDirectory(),
  writable(path) {
    try {
      accessSync(path, constants.W_OK)
      return true
    } catch {
      return false
    }
  },
}

/** The `engines.node` range of this package's `package.json`. */
export function enginesNode(root: () => string = pluginRoot): string {
  try {
    const manifest = JSON.parse(readFileSync(join(root(), 'package.json'), 'utf8')) as {
      engines?: { node?: string }
    }
    return manifest.engines?.node ?? ''
  } catch {
    // An install without the manifest has no range to check; the check reports that.
    return ''
  }
}

/** The real files, clock and process behind `doctor`; `exec` and the machine config come from `deps`. */
export function createDoctorIo(
  deps: Pick<ReviewDeps, 'exec' | 'configs'>,
  env: Record<string, string | undefined> = process.env,
): DoctorIo {
  return {
    env,
    now: () => new Date(),
    nodeVersion: process.versions.node,
    nodeRange: enginesNode(),
    exec: deps.exec,
    fs: realFs,
    loadApp: () => loadAppConfig(env),
    configs: deps.configs,
    configDir: machineConfigDir(env),
    stateDir: stateHome(env),
    tmpDir: tmpdir(),
    claudeHome: env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude'),
    findClone: (root, repo) => findClone(root, repo, runGit),
  }
}

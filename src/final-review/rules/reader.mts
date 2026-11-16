import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import type { RunTextCommand } from '../../gh-cli/index.mts'

/** A read-only view of one rule source: a directory or a git ref. */
export type RuleReader = {
  label: string
  list(): Promise<string[]>
  read(path: string): Promise<string | undefined>
}

const SKIPPED = new Set(['node_modules', '.git', 'target', 'coverage', '.final-review'])

function skipped(path: string): boolean {
  return path.split('/').some((part) => SKIPPED.has(part)) || path.includes('.claude/worktrees/')
}

/** Walks a directory on disk; paths are `/`-separated and relative to `root`. */
export function dirReader(root: string, label = 'dir'): RuleReader {
  return {
    label,
    list: async () =>
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
        .filter((path) => !skipped(path))
        .sort(),
    read: async (path) => {
      try {
        return readFileSync(join(root, path), 'utf8')
      } catch {
        return undefined
      }
    },
  }
}

/** Reads a repository at a ref with git, never touching its working tree. */
export function gitReader(
  repoDir: string,
  ref: string,
  git: RunTextCommand,
  label = ref,
): RuleReader {
  return {
    label,
    async list() {
      // `-z` keeps non-ASCII paths verbatim; otherwise git quotes and octal-escapes them.
      const out = await git(['-C', repoDir, 'ls-tree', '-r', '-z', '--name-only', ref])
      return out.split('\0').filter((line) => line.length > 0)
    },
    async read(path) {
      try {
        return await git(['-C', repoDir, 'show', `${ref}:${path}`])
      } catch {
        return undefined
      }
    },
  }
}

/** The remote default branch (`origin/main`), else `origin/main`, else `HEAD`. */
export async function defaultRef(repoDir: string, git: RunTextCommand): Promise<string> {
  try {
    const head = (await git(['-C', repoDir, 'rev-parse', '--abbrev-ref', 'origin/HEAD'])).trim()
    if (head.length > 0 && head !== 'origin/HEAD') return head
  } catch {
    // No origin/HEAD symbolic ref in this clone.
  }
  try {
    await git(['-C', repoDir, 'rev-parse', '--verify', '--quiet', 'origin/main'])
    return 'origin/main'
  } catch {
    return 'HEAD'
  }
}

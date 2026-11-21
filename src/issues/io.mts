import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { splitRepo, type RunTextCommand } from '../gh-cli/index.mts'
import type { IssuesIo } from './file.mts'

/** A `gh` call that has not answered by now is given up on. */
export const GH_TIMEOUT_MS = 30_000

/** Rejects when `work` has not settled within `ms`. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`gh did not answer within ${ms} ms`)), ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

/** `gh` through the same App or login credentials as every command, scoped to the target repository. */
export function createIssuesIo(
  runner: (owner: string, repo: string) => RunTextCommand,
  timeoutMs = GH_TIMEOUT_MS,
): IssuesIo {
  return {
    gh: (repo, args) => {
      const { owner, name } = splitRepo(repo)
      return within(runner(owner, name)(args), timeoutMs)
    },
    withBodyFile: async (body, use) => {
      const dir = mkdtempSync(join(tmpdir(), 'code-reviewer-issue-'))
      try {
        const path = join(dir, 'body.md')
        writeFileSync(path, body)
        return await use(path)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}

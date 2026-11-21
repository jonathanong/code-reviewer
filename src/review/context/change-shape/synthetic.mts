import type { Exec } from '../../benchmark/exec.mts'
import type { FileChange, Hunk } from './types.mts'

/** Builders of synthetic `git` output for tests; no repository is involved. */

export const numstatZ = (files: readonly FileChange[]): string =>
  files
    .map((file) =>
      file.oldPath === undefined
        ? `${file.added}\t${file.deleted}\t${file.path}\0`
        : `${file.added}\t${file.deleted}\t\0${file.oldPath}\0${file.path}\0`,
    )
    .join('')

export const nameStatusZ = (files: readonly FileChange[]): string =>
  files
    .map((file) =>
      file.oldPath === undefined
        ? `${file.status}\0${file.path}\0`
        : `${file.status}\0${file.oldPath}\0${file.path}\0`,
    )
    .join('')

/** A `-U0` patch: one file section per distinct path, hunks in order. */
export function patchOf(hunks: readonly Hunk[]): string {
  const paths = [...new Set(hunks.map((hunk) => hunk.path))]
  return paths
    .map((path) => {
      const body = hunks
        .filter((hunk) => hunk.path === path)
        .map((hunk, index) =>
          [
            `@@ -${index + 1},${hunk.removed.length} +${index + 1},${hunk.added.length} @@`,
            ...hunk.removed.map((line) => `-${line}`),
            ...hunk.added.map((line) => `+${line}`),
          ].join('\n'),
        )
      return [
        `diff --git a/${path} b/${path}`,
        'index 1..2 100644',
        `--- a/${path}`,
        `+++ b/${path}`,
        ...body,
      ].join('\n')
    })
    .join('\n')
    .concat('\n')
}

export const file = (path: string, added: number, deleted: number, status = 'M'): FileChange => ({
  path,
  status,
  added,
  deleted,
})

export type Repo = {
  files: FileChange[]
  patch: string
  /** The `-w` patch; defaults to the full patch. */
  wPatch?: string
  log?: string
  /** `rev:path` to file text. */
  show?: Record<string, string>
  mergeBase?: string
}

/** A fake `exec` that answers the git commands the section runs and records them. */
export function fakeGit(repo: Repo): { exec: Exec; calls: string[][] } {
  const calls: string[][] = []
  const exec: Exec = async (_command, args) => {
    calls.push(args)
    if (args[0] === 'merge-base') {
      if (repo.mergeBase === undefined) throw new Error('no merge base')
      return `${repo.mergeBase}\n`
    }
    if (args[0] === 'show') {
      const text = repo.show?.[args[1] as string]
      if (text === undefined) throw new Error('missing')
      return text
    }
    if (args[0] === 'log') return repo.log ?? ''
    if (args.includes('--numstat') && args[0] === 'diff') return numstatZ(repo.files)
    if (args.includes('--name-status')) return nameStatusZ(repo.files)
    return args.includes('-w') ? (repo.wPatch ?? repo.patch) : repo.patch
  }
  return { exec, calls }
}

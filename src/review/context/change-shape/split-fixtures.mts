import type { Exec } from '../../benchmark/exec.mts'
import { fakeGit, file, patchOf } from './synthetic.mts'
import type { FileChange, Hunk } from './types.mts'

/** Synthetic repositories for the split proposal tests; no repository is involved. */

const letToConst = (path: string, index: number): Hunk => ({
  path,
  removed: [`  let item${index} = ${index}`, `  let other${index} = 'v${index}'`],
  added: [`  const item${index} = ${index}`, `  const other${index} = 'v${index}'`],
})

const mechanical = (count: number) => {
  const paths = Array.from({ length: count }, (_, i) => `src/m${i}/file${i}.ts`)
  return { files: paths.map((path) => file(path, 2, 2)), hunks: paths.map(letToConst) }
}

/** Hand-written hunks that no two share a shape with. */
const handWritten = (count: number, size: number) => {
  const hunks = Array.from({ length: count }, (_, i): Hunk => ({
    path: `lib/h${i}.ts`,
    removed: [`call${i}(x)`],
    added: Array.from({ length: i + 1 }, (_, k) => `step${k}()`),
  }))
  return { files: hunks.map((hunk) => file(hunk.path, size, 0)), hunks }
}

const oxlintBefore = JSON.stringify({ rules: { 'prefer-const': 'off' } })
const oxlintAfter = JSON.stringify({ rules: { 'prefer-const': 'error' } })

function repoOf(files: FileChange[], hunks: Hunk[], config = false): Exec {
  return fakeGit({
    files: config ? [...files, file('.oxlintrc.json', 1, 1)] : files,
    patch: patchOf(
      config
        ? [...hunks, { path: '.oxlintrc.json', removed: ['"prefer-const": "off"'], added: ['"x"'] }]
        : hunks,
    ),
    mergeBase: 'mb',
    show: { 'mb:.oxlintrc.json': oxlintBefore, 'head:.oxlintrc.json': oxlintAfter },
  }).exec
}

/** A git fake that also answers when the command comes as `git -C <tree> ...`. */
const withTree =
  (git: Exec): Exec =>
  (command, args, options) =>
    git(command, args[0] === '-C' ? args.slice(2) : args, options)

/** 40 lines-and-config files changed mechanically, plus 8 hand-written files: worth a split. */
export const mixedRepo = (): Exec => {
  const mech = mechanical(40)
  const hand = handWritten(8, 25)
  return withTree(repoOf([...mech.files, ...hand.files], [...mech.hunks, ...hand.hunks], true))
}

/** Only the mechanical change, 100 files: fine as it is. */
export const mechanicalOnlyRepo = (): Exec => {
  const mech = mechanical(100)
  return withTree(repoOf(mech.files, mech.hunks, true))
}

/** Large, with nothing repeated: big alone is no reason to propose a split. */
export const handWrittenOnlyRepo = (): Exec => {
  const hand = handWritten(8, 50)
  return withTree(repoOf(hand.files, hand.hunks))
}

/** Under the small-change threshold. */
export const smallRepo = (): Exec => {
  const hand = handWritten(2, 10)
  return withTree(repoOf(hand.files, hand.hunks))
}

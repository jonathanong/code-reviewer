import type { CarriedFile } from '../carried-file.mts'
import { carriedNotes, homeName, plain } from '../carried-note.mts'

/** The carried commits and base branch state as `report.md` shows them. */
export function renderCarried(file: CarriedFile): string[] {
  const commits = file.commits.map(
    (commit) =>
      `- \`${commit.sha.slice(0, 7)}\` ${plain(commit.subject)}: in ${homeName(commit.home, file.defaultBranch)}, by ${commit.how}`,
  )
  return [
    '### Carried changes',
    ...carriedNotes(file).map((note) => `- ${note}`),
    ...(commits.length === 0
      ? []
      : [`Commits not reviewed as this pull request's own:\n\n${commits.join('\n')}`]),
    ...(file.filesTotal === 0
      ? []
      : [`${file.filesTotal} file(s) are changed only by those commits.`]),
    ...file.problems.map((problem) => `Problem: ${problem}`),
  ]
}

import { baseIsDead, type CarriedFile, type CarriedHome } from './carried-file.mts'

const SHOWN_SHAS = 5

/** A branch name or subject is untrusted: one line, no backticks, bounded. */
export const plain = (text: string, max = 100) =>
  text
    .replace(/[\s`]+/gu, ' ')
    .trim()
    .slice(0, max)

export const homeName = (home: CarriedHome, defaultBranch: string | null) =>
  home.kind === 'pull' ? `#${home.number}` : `\`${plain(defaultBranch ?? 'the default branch')}\``

/**
 * What the posted review and the report say, once, about carried commits and a dead base branch.
 * Written in code, so it never depends on a model; it is a note, not a finding.
 */
export function carriedNotes(file: CarriedFile): string[] {
  const target =
    file.defaultBranch === null ? 'the default branch' : `\`${plain(file.defaultBranch)}\``
  const base = file.baseRef === null ? 'the base branch' : `\`${plain(file.baseRef)}\``
  const notes: string[] = []
  if (baseIsDead(file)) {
    const state =
      file.baseMergedIn === undefined
        ? `Base branch ${base} no longer exists`
        : `Base branch ${base} was merged in #${file.baseMergedIn}`
    notes.push(
      `${state}, so this diff may include changes that are not this pull request's own; retarget it to ${target}.`,
    )
  }
  if (file.commits.length > 0) {
    const homes = [
      ...new Set(file.commits.map((commit) => homeName(commit.home, file.defaultBranch))),
    ]
    const shas = file.commits.slice(0, SHOWN_SHAS).map((commit) => `\`${commit.sha.slice(0, 7)}\``)
    const more =
      file.commits.length > SHOWN_SHAS ? ` and ${file.commits.length - SHOWN_SHAS} more` : ''
    notes.push(
      `${file.commits.length} of ${file.commitsInRange} commits in this diff already exist in ${homes.join(', ')} and were not reviewed as this pull request's own: ${shas.join(', ')}${more}.`,
    )
  }
  return notes
}

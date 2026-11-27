import type { PackageFiles } from './tarball.mts'
import { compareVersions, parseVersion, type Version } from './version.mts'

export const MAX_CHANGELOG_CHARS = 8000

const FILE = /^(?:changelog|changes|history|releases?)(?:\.(?:md|markdown|txt))?$/iu
/** A heading, or a line that starts with a version: `## 0.8.0`, `## [0.8.0] - date`, `v0.8.0 (date)`. */
const HEADING = /^(?:#{1,6}\s*)?\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?=$|[\s(:,/-])/u

export type ChangelogEntries = {
  /** The entries newer than `from` up to `to`, as written; empty when none were found. */
  text: string
  /** Why there is no text, or that it was cut. */
  note?: string
}

/** The changelog of a published package between two versions: `from` excluded, `to` included. */
export function changelogBetween(
  files: PackageFiles,
  from: Version,
  to: Version,
): ChangelogEntries {
  const name = [...files.keys()].find((path) => !path.includes('/') && FILE.test(path))
  if (name === undefined) return { text: '', note: 'The published package has no changelog file.' }
  const sections: { version: Version; lines: string[] }[] = []
  for (const line of (files.get(name) as Buffer).toString('utf8').split('\n')) {
    const version = parseVersion(HEADING.exec(line)?.[1] ?? '')
    if (version !== undefined) sections.push({ version, lines: [] })
    sections.at(-1)?.lines.push(line)
  }
  const wanted = sections.filter(
    ({ version }) => compareVersions(version, from) > 0 && compareVersions(version, to) <= 0,
  )
  if (wanted.length === 0) {
    return { text: '', note: `\`${name}\` has no entry between ${from.text} and ${to.text}.` }
  }
  const body = wanted.map(({ lines }) => lines.join('\n').trim()).join('\n\n')
  if (body.length <= MAX_CHANGELOG_CHARS) return { text: body }
  const cut = body.slice(0, MAX_CHANGELOG_CHARS)
  return {
    text: cut.slice(0, cut.lastIndexOf('\n')),
    note: `\`${name}\` is cut at ${MAX_CHANGELOG_CHARS} characters; later entries are in the package.`,
  }
}

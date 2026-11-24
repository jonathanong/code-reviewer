import { cellPath } from './focus-facts-render.mts'
import type { NamedPrFact } from './focus-named-prs.mts'

/** One computed block per named pull request. Paths are data, so they go through the shared escaping. */
export function renderNamedPrFacts(facts: readonly NamedPrFact[]): string[] {
  return facts.map(({ number, head, files }) => {
    const title = `## Pull request #${number}, named in a point`
    if (head === null || files === null) {
      return `${title}\n\nPull request #${number} could not be read from git, so what it changes is unknown.`
    }
    const { total, shared, omitted, listed } = files
    const known = shared !== null
    const clip =
      omitted > 0
        ? ` (showing ${listed.length}${known ? ', shared files first' : ''}; ${omitted} omitted)`
        : ''
    const overlap = known
      ? `${shared} also changed by this pull request`
      : "which of them this pull request also changes is unknown, because this pull request's own changed files could not be read"
    const mark = (value: boolean | null) => (value === null ? 'unknown' : value ? 'yes' : 'no')
    const rows = listed.map((file) => {
      const name =
        file.oldPath === undefined
          ? cellPath(file.path)
          : `${cellPath(file.path)} (from ${cellPath(file.oldPath)})`
      return `| ${name} | ${file.status} | ${mark(file.shared)} |`
    })
    return [
      title,
      `Computed from git: head \`${head}\`, ${total} changed files since its merge base with this review's base, ${overlap}${clip}. The file contents of pull request #${number} are not in the checkout.`,
      ...(rows.length === 0
        ? []
        : [`| File | Status | Also changed here |\n| --- | --- | --- |\n${rows.join('\n')}`]),
    ].join('\n\n')
  })
}

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
    const clip =
      omitted > 0 ? ` (showing ${listed.length}, shared files first; ${omitted} omitted)` : ''
    const rows = listed.map((file) => {
      const name =
        file.oldPath === undefined
          ? cellPath(file.path)
          : `${cellPath(file.path)} (from ${cellPath(file.oldPath)})`
      return `| ${name} | ${file.status} | ${file.shared ? 'yes' : 'no'} |`
    })
    return [
      title,
      `Computed from git: head \`${head}\`, ${total} changed files since its merge base with this review's base, ${shared} also changed by this pull request${clip}. The file contents of pull request #${number} are not in the checkout.`,
      ...(rows.length === 0
        ? []
        : [`| File | Status | Also changed here |\n| --- | --- | --- |\n${rows.join('\n')}`]),
    ].join('\n\n')
  })
}

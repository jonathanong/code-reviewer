import type { FocusFacts } from './focus-facts.mts'

const cellPath = (path: string): string => `\`${path.replaceAll('|', '\\|')}\``

/** Renders computed change facts as a compact Markdown block, or undefined when nothing is known. */
export function renderFocusFacts(facts: FocusFacts): string | undefined {
  const blocks: string[] = []
  const prParts = [
    ...(facts.titleChars === null ? [] : [`title ${facts.titleChars} characters`]),
    ...(facts.descriptionChars === null
      ? []
      : [`description ${facts.descriptionChars} characters`]),
  ]
  if (prParts.length > 0) blocks.push(`Pull request: ${prParts.join(', ')}.`)
  if (facts.files !== null) {
    const { total, omitted, listed } = facts.files
    blocks.push(
      omitted > 0
        ? `Changed files: ${total} (showing the ${listed.length} with the most changed lines; ${omitted} omitted).`
        : `Changed files: ${total}.`,
    )
    if (listed.length > 0) {
      const hasDesc = listed.some((file) => file.descriptionChars !== null)
      const head = `| File | Status | + | - | Lines at head |${hasDesc ? ' Description chars |' : ''}`
      const sep = `| --- | --- | ---: | ---: | ---: |${hasDesc ? ' ---: |' : ''}`
      const rows = listed.map((file) => {
        const name =
          file.oldPath === undefined
            ? cellPath(file.path)
            : `${cellPath(file.path)} (from ${cellPath(file.oldPath)})`
        const plus = file.binary ? 'binary' : file.added === null ? '-' : String(file.added)
        const minus = file.binary ? 'binary' : file.removed === null ? '-' : String(file.removed)
        const lines = file.lines === null ? '-' : String(file.lines)
        const desc = hasDesc ? ` ${file.descriptionChars ?? '-'} |` : ''
        return `| ${name} | ${file.status ?? '-'} | ${plus} | ${minus} | ${lines} |${desc}`
      })
      blocks.push([head, sep, ...rows].join('\n'))
    }
  }
  return blocks.length === 0 ? undefined : ['## Change facts', ...blocks].join('\n\n')
}

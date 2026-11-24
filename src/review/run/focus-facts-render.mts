export type FocusFileFact = {
  path: string
  oldPath?: string
  status: string | null
  binary: boolean
  added: number | null
  removed: number | null
  lines: number | null
  descriptionChars: number | null
}

export type FocusFacts = {
  titleChars: number | null
  descriptionChars: number | null
  descriptionClipped: boolean
  /** Null when neither numstat nor name-status could be read from git. */
  files: { total: number; omitted: number; listed: FocusFileFact[] } | null
}

export function cellPath(path: string): string {
  const safe = path.replaceAll('\r', '\\r').replaceAll('\n', '\\n').replaceAll('|', '\\|')
  const runs = safe.match(/`+/gu)
  if (runs === null) return `\`${safe}\``
  const fence = '`'.repeat(Math.max(...runs.map((run) => run.length)) + 1)
  return `${fence} ${safe} ${fence}`
}

/** Renders computed change facts as a compact Markdown block, or undefined when nothing is known. */
export function renderFocusFacts(facts: FocusFacts): string | undefined {
  const blocks: string[] = []
  const prParts = [
    ...(facts.titleChars === null ? [] : [`title ${facts.titleChars} characters`]),
    ...(facts.descriptionChars === null
      ? []
      : [
          facts.descriptionClipped
            ? `description at least ${facts.descriptionChars} characters (clipped)`
            : `description ${facts.descriptionChars} characters`,
        ]),
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

import { MIN_REPEAT } from './analyze.mts'
import type { ChangeShape, Hunk, Tally } from './types.mts'

const LINE_CHARS = 160
const EXAMPLE_LINES = 6
const ROWS = 8

const clip = (line: string): string =>
  line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}...` : line

const tallyLine = (row: Tally): string =>
  `- ${row.name}: ${row.files} files, +${row.added} -${row.deleted}`

function example(hunk: Hunk): string[] {
  const shown = (lines: string[], mark: string): string[] => [
    ...lines.slice(0, EXAMPLE_LINES).map((line) => `${mark}${clip(line)}`),
    ...(lines.length > EXAMPLE_LINES
      ? [`${mark}... ${lines.length - EXAMPLE_LINES} more lines`]
      : []),
  ]
  const body = [...shown(hunk.removed, '-'), ...shown(hunk.added, '+')]
  const longest = Math.max(0, ...(body.join('\n').match(/`+/gu) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return [`  ${hunk.path}`, '', `${fence}diff`, ...body, fence]
}

function repetition(shape: ChangeShape): string[] {
  if (shape.top.length === 0) {
    return [`No change repeats in ${MIN_REPEAT} or more of the ${shape.hunks} analysed hunks.`]
  }
  const covers =
    shape.top.length === 1
      ? `the one repeated signature covers ${shape.top1Share}%`
      : `the top signature covers ${shape.top1Share}% and the top ${shape.top.length} cover ${shape.top3Share}%`
  const lines = [`Of ${shape.hunks} hunks (generated files excluded), ${covers}.`]
  shape.top.forEach((group, index) => {
    lines.push(
      '',
      `${index + 1}. ${group.hunks} hunks in ${group.files} files; example:`,
      ...example(group.example),
    )
  })
  return lines
}

function whitespace(shape: ChangeShape): string[] {
  const parts = [`${shape.renames} files are pure renames (R100).`]
  parts.push(
    shape.whitespace === null
      ? 'Whitespace-only hunks were not counted (patch cap).'
      : `${shape.whitespace.vanish} of ${shape.whitespace.hunks} hunks vanish under \`git diff -w\`.`,
  )
  return parts
}

function configs(shape: ChangeShape): string[] {
  if (shape.configs.length === 0) return ['No lint, format or compiler config file changed.']
  return shape.configs.map((config) => {
    if (config.keys === null) return `- ${config.path} (changed keys not read)`
    if (config.keys.length === 0) return `- ${config.path} (no key changed)`
    const more = config.moreKeys > 0 ? `, and ${config.moreKeys} more` : ''
    return `- ${config.path}: ${config.keys.map((key) => `\`${key}\``).join(', ')}${more}`
  })
}

function commits(shape: ChangeShape): string[] {
  const { total, capped, listed } = shape.commits
  const head = `${capped ? 'At least ' : ''}${total} commits.`
  const rows = listed.map(
    (commit) =>
      `- ${commit.id} ${clip(commit.subject)}: ${commit.files} files, +${commit.added} -${commit.deleted}`,
  )
  const more = total > listed.length ? [`- ... ${total - listed.length} more`] : []
  return [head, ...rows, ...more]
}

/** The section body; every number comes from the shape. */
export function renderChangeShape(shape: ChangeShape): string {
  const lines = [
    `${shape.files} files, +${shape.added} -${shape.deleted} (${shape.reviewableLines} lines outside generated files).`,
    '',
    '### By top-level directory',
    ...shape.byDir.slice(0, ROWS).map(tallyLine),
    ...(shape.byDir.length > ROWS ? [`- ... ${shape.byDir.length - ROWS} more`] : []),
    '',
    '### By kind',
    ...shape.byKind.map(tallyLine),
    '',
    '### Repetition',
    ...repetition(shape),
    '',
    '### Renames and whitespace',
    ...whitespace(shape),
    '',
    '### Config that may explain a mechanical change',
    ...configs(shape),
    '',
    '### Commits',
    ...commits(shape),
    '',
    '### Areas touched outside the repeated changes',
    ...(shape.concerns.length === 0
      ? ['None.']
      : shape.concerns.map((concern) => `- ${concern.dir} (${concern.hunks} hunks)`)),
  ]
  if (shape.capNotes.length > 0) lines.push('', `Caps hit: ${shape.capNotes.join('; ')}.`)
  return lines.join('\n')
}

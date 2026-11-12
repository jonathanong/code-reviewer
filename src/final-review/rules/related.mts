import type { RuleReader } from './reader.mts'

export type Candidate = { name: string; reader: RuleReader; codeHint: string }
export type Related = { name: string; packages: string[]; where: string }

export const MAX_RELATED = 5

const PACKAGE_JSON = /^(?:packages\/[^/]+\/)?package\.json$/u
const FILE_HEADER = /^diff --git (?:"a\/.*"|a\/.*) (?:"b\/(.*)"|b\/(.*))$/u

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

async function packageNames(reader: RuleReader): Promise<string[]> {
  const names: string[] = []
  const files = await reader.list().catch(() => [])
  for (const path of files.filter((file) => PACKAGE_JSON.test(file))) {
    try {
      const { name } = JSON.parse((await reader.read(path)) ?? '') as { name?: unknown }
      if (typeof name === 'string' && name.length > 0) names.push(name)
    } catch {
      // A missing or malformed package.json names nothing.
    }
  }
  return names
}

type Line = { path: string; text: string }

/** Content lines (`+`, `-`, or space; not file headers) with the file they belong to. */
function contentLines(diff: string): Line[] {
  const lines: Line[] = []
  let path = ''
  for (const text of diff.split('\n')) {
    const header = FILE_HEADER.exec(text)
    if (header !== null) path = (header[1] ?? header[2]) as string
    else if (/^[-+ ]/u.test(text) && !text.startsWith('+++') && !text.startsWith('---')) {
      lines.push({ path, text })
    }
  }
  return lines
}

/**
 * Candidate repositories whose published packages the diff imports (a quoted module specifier) or
 * whose `owner/name` a workflow `uses:`; at most five, in candidate order.
 */
export async function findRelated(
  candidates: readonly Candidate[],
  diff: string,
  exclude = '',
): Promise<Related[]> {
  const lines = contentLines(diff)
  const related: Related[] = []
  for (const candidate of candidates) {
    if (related.length >= MAX_RELATED) break
    if (candidate.name === exclude) continue
    const packages: string[] = []
    let where: string | undefined
    for (const name of await packageNames(candidate.reader)) {
      const spec = new RegExp(`['"]${escape(name)}(?:/[^'"]*)?['"]`, 'u')
      const hit = lines.find((line) => spec.test(line.text))
      if (hit === undefined) continue
      packages.push(name)
      where ??= hit.path
    }
    const uses = new RegExp(`uses:\\s*['"]?[\\w.-]+/${escape(candidate.name)}(?:[/@'"\\s]|$)`, 'u')
    const action = lines.find((line) => uses.test(line.text))
    if (action !== undefined) where ??= action.path
    if (where !== undefined) related.push({ name: candidate.name, packages, where })
  }
  return related
}

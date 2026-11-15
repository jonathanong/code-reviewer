import { skillInfo } from './collect.mts'
import type { Staged } from './index-render.mts'
import type { RuleReader } from './reader.mts'

/** Staged file path (relative to the output directory) to its text. */
export type Files = Map<string, string>

/** Copies `paths` into `rules/<dest>/`, dropping `strip` from each; returns what was staged. */
export async function copy(
  files: Files,
  reader: RuleReader,
  dest: string,
  paths: readonly string[],
  strip = '',
): Promise<Map<string, string>> {
  const staged = new Map<string, string>()
  for (const path of paths) {
    const text = await reader.read(path)
    if (text === undefined) continue
    const rel = `${dest}/${path.slice(strip.length)}`
    files.set(`rules/${rel}`, text)
    staged.set(rel, text)
  }
  return staged
}

export function classify(staged: Map<string, string>): Staged {
  const paths = [...staged.keys()]
  const isSkill = (path: string) => path.endsWith('/SKILL.md')
  const isInstruction = (path: string) => /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/u.test(path)
  return {
    instructions: paths.filter((path) => isInstruction(path)),
    skills: paths.filter(isSkill).map((path) => skillInfo(path, staged.get(path) as string)),
    references: paths.filter((path) => !isSkill(path) && !isInstruction(path)),
  }
}

export async function listAll(
  reader: RuleReader,
  name: string,
  missing: string[],
): Promise<string[]> {
  try {
    return await reader.list()
  } catch {
    missing.push(`${name}: could not list files at ${reader.label}`)
    return []
  }
}

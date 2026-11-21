import { join } from 'node:path'

import { buildContext, sectionsNamed } from '../context/build.mts'
import { renderContext } from '../context/render.mts'
import type { ExcerptsMode } from '../context/types.mts'
import { DEFAULT_RULE_PLUGINS, parsePluginInstalls } from '../plugins.mts'
import { listRuleSkillFiles } from '../run/select-skills.mts'
import type { Exec } from './exec.mts'
import { CONTEXT_DIR } from './snapshot-context.mts'

/** Where a pillar finds the excerpts, relative to the snapshot, as review's `review-context.md`. */
export const EXCERPTS_FILE = `${CONTEXT_DIR}/review-context.md`

type Deps = {
  exec: Exec
  readFile(path: string): string
  writeFile(path: string, text: string): void
}

/** Validates `--excerpts`; the arm needs the selected skills, so it cannot run without `--select`. */
export function parseExcerpts(
  value: string | undefined,
  select: boolean,
  noRules: boolean,
): ExcerptsMode | undefined {
  if (value === undefined) return undefined
  if (value !== 'alongside' && value !== 'replace')
    throw new Error('--excerpts must be alongside or replace.')
  if (!select || noRules)
    throw new Error('--excerpts needs --select and cannot be used with --no-rules.')
  return value
}

/**
 * Makes `bench --excerpts` build review's rule-excerpts section for the skills `--select` chose,
 * as `review` does, and write it to each snapshot. Returns the writer for one case.
 */
export async function excerptWriter(
  mode: ExcerptsMode,
  deps: Deps,
): Promise<(dir: string, selected: readonly string[]) => Promise<void>> {
  const installs = parsePluginInstalls(await deps.exec('claude', ['plugin', 'list', '--json']))
  const all = listRuleSkillFiles(installs, DEFAULT_RULE_PLUGINS)
  return async (dir, selected) => {
    const skills = all.filter((skill) => selected.includes(skill.name))
    // The rule-excerpts builder reads only `skills` and `excerpts`; the rest names no real pull request.
    const built = await buildContext(
      { repo: '', pr: 0, tree: dir, baseSha: '', headSha: '', out: dir, skills, excerpts: mode },
      { exec: deps.exec, readFile: async (path) => deps.readFile(path) },
      sectionsNamed(['rule-excerpts']),
    )
    // An empty build still gets a file, so both arms point at the same path.
    deps.writeFile(join(dir, EXCERPTS_FILE), renderContext(built))
  }
}

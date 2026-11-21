import { join } from 'node:path'

import { DEFAULT_RULE_PLUGINS, parsePluginInstalls } from '../plugins.mts'
import { listRuleSkills, selectSkills } from '../run/select-skills.mts'
import type { SkillChoice } from '../run/types.mts'
import type { EvalCase } from './cases.mts'
import type { Exec } from './exec.mts'
import { selectionText } from './selection-input.mts'
import type { Snapshot } from './snapshot.mts'

/** The real selection step and skill listing, replaceable in tests. */
export type SelectStep = { skills: typeof listRuleSkills; select: typeof selectSkills }

export const defaultSelectStep: SelectStep = { skills: listRuleSkills, select: selectSkills }

type SelectorDeps = {
  exec: Exec
  readFile(path: string): string
  writeFile(path: string, text: string): void
  exists(path: string): boolean
}

/**
 * Makes `bench --select` choose skills the way `review` does: one Haiku call per case over the
 * title, file index and diff excerpt. The choice is saved to `<out>/selection/<id>.json` and a
 * saved one is reused, so every pillar of a case, and a resumed run, sees the same skills.
 */
export async function caseSelector(
  out: string,
  settings: object | undefined,
  deps: SelectorDeps,
  step: SelectStep,
): Promise<(item: EvalCase, snapshot: Snapshot) => Promise<string[]>> {
  const skills = step.skills(
    parsePluginInstalls(await deps.exec('claude', ['plugin', 'list', '--json'])),
    DEFAULT_RULE_PLUGINS,
  )
  return async (item, snapshot) => {
    const path = join(out, 'selection', `${item.id}.json`)
    if (deps.exists(path)) return (JSON.parse(deps.readFile(path)) as SkillChoice).selected
    const choice = await step.select({
      ...selectionText(snapshot, (file) => deps.readFile(file)),
      skills,
      ...(settings === undefined ? {} : { settings }),
      exec: deps.exec,
      cwd: snapshot.dir,
    })
    deps.writeFile(path, `${JSON.stringify(choice, null, 2)}\n`)
    return choice.selected
  }
}

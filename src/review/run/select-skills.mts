import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describeStepFailure } from '../../harness/runner.mts'
import { NO_TOOLS } from '../../harness/types.mts'
import type { Exec } from '../benchmark/exec.mts'
import { addUsage } from '../benchmark/usage.mts'
import { DEFAULT_STEP_MODELS, runModelStep, type StepModels } from '../models.mts'
import type { PluginInstall } from '../plugins.mts'
import { parseFrontmatter } from '../rules/collect.mts'
import type { TargetOffer } from '../targets.mts'
import {
  buildSelectionPrompt,
  SKILL_AND_TARGET_SELECTION_SCHEMA,
  SKILL_SELECTION_SCHEMA,
  TARGET_ONLY_SELECTION_SCHEMA,
  type RuleSkill,
} from './select-prompt.mts'
import { SELECT_TIMEOUT_MS, type SkillChoice } from './types.mts'

export {
  buildSelectionPrompt,
  SKILL_AND_TARGET_SELECTION_SCHEMA,
  SKILL_SELECTION_SCHEMA,
  TARGET_ONLY_SELECTION_SCHEMA,
  type RuleSkill,
}

/** The skills of the installed `rulePlugins`, from their `skills/<dir>/SKILL.md` frontmatter. */
export const listRuleSkills = (
  installs: readonly PluginInstall[],
  rulePlugins: readonly string[],
): RuleSkill[] =>
  listRuleSkillFiles(installs, rulePlugins).map(({ name, description }) => ({ name, description }))

/**
 * `listRuleSkills` with the absolute path of each SKILL.md. A SKILL.md that cannot be read throws,
 * unless `unreadable` is given: then it is skipped and a line naming it is added there.
 */
export function listRuleSkillFiles(
  installs: readonly PluginInstall[],
  rulePlugins: readonly string[],
  unreadable?: string[],
): (RuleSkill & { file: string })[] {
  const found: (RuleSkill & { file: string })[] = []
  for (const plugin of rulePlugins) {
    const install = installs.find((candidate) => candidate.name === plugin)
    const root = install === undefined ? '' : join(install.installPath, 'skills')
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const file = join(root, entry.name, 'SKILL.md')
      if (!entry.isDirectory() || !existsSync(file)) continue
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch (error) {
        if (unreadable === undefined) throw error
        unreadable.push(`${plugin}:${entry.name} could not be read: ${(error as Error).message}`)
        continue
      }
      const { name, description } = parseFrontmatter(text)
      found.push({
        name: `${plugin}:${name ?? entry.name}`,
        description: (description ?? '').replace(/\s+/gu, ' ').trim(),
        file,
      })
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

export type SelectionInput = {
  title: string
  index: string
  excerpt?: string
  skills: readonly RuleSkill[]
  targets?: readonly TargetOffer[]
  rulePlugins?: readonly string[]
  settings?: object
  models?: StepModels
  exec: Exec
  cwd: string
}

/**
 * Picks the rule skills (and any offered built-in targets) for the change. A failed call is tried
 * once more. With no rule plugins and no targets offered there is nothing to pick and no model
 * call; with no rule plugins but targets offered, the call selects targets only.
 */
export async function selectSkills(input: SelectionInput): Promise<SkillChoice> {
  const available = input.skills.length
  const offeredTargets = input.targets ?? []
  const targetsOnly = input.rulePlugins?.length === 0
  if (targetsOnly && offeredTargets.length === 0) return { selected: [], available, usage: null }
  if (!targetsOnly && available === 0) {
    return { selected: [], available, error: 'No rule skills are installed.', usage: null }
  }
  const first = await selectOnce(input, available, targetsOnly)
  if (first.error === undefined) return first
  const second = await selectOnce(input, available, targetsOnly)
  // The second attempt's model is the one recorded; the first attempt's wait still happened.
  const waited = first.ran?.waitedMs ?? 0
  const ran =
    second.ran === undefined
      ? {}
      : { ran: { ...second.ran, waitedMs: second.ran.waitedMs + waited } }
  return { ...second, usage: addUsage(first.usage, second.usage), ...ran }
}

/** One call on the `select` step's small model, with no tools. */
async function selectOnce(
  input: SelectionInput,
  available: number,
  targetsOnly: boolean,
): Promise<SkillChoice> {
  const offeredTargets = input.targets ?? []
  const prompt = buildSelectionPrompt(
    input.title,
    input.index,
    input.skills,
    input.excerpt,
    offeredTargets,
    targetsOnly,
  )
  const schema = targetsOnly
    ? TARGET_ONLY_SELECTION_SCHEMA
    : offeredTargets.length === 0
      ? SKILL_SELECTION_SCHEMA
      : SKILL_AND_TARGET_SELECTION_SCHEMA
  try {
    const { structured, usage, ran } = await runModelStep(
      input.models ?? DEFAULT_STEP_MODELS,
      { keys: ['select'], fallback: 'small' },
      {
        prompt,
        label: 'Skill selection',
        maxTurns: 3,
        schema,
        can: NO_TOOLS,
        cwd: input.cwd,
        timeoutMs: SELECT_TIMEOUT_MS,
        transcript: true,
        ...(input.settings === undefined ? {} : { settings: input.settings }),
      },
      input.exec,
    )
    const answer = structured as { skills?: unknown; targets?: unknown } | undefined
    const targetNames = new Set(offeredTargets.map((target) => target.name))
    const targets = Array.isArray(answer?.targets)
      ? [
          ...new Set(
            answer.targets.filter((name): name is string => targetNames.has(name as string)),
          ),
        ]
      : []
    if (targetsOnly) return { selected: [], targets, available, usage, ran }
    if (!Array.isArray(answer?.skills)) {
      return { selected: [], available, error: 'No skills returned.', usage, ran }
    }
    const offered = new Set(input.skills.map((skill) => skill.name))
    const selected = [
      ...new Set(answer.skills.filter((name): name is string => offered.has(name as string))),
    ]
    return {
      selected,
      ...(offeredTargets.length === 0 ? {} : { targets }),
      available,
      usage,
      ran,
    }
  } catch (error) {
    const { message, usage, ran } = describeStepFailure(error)
    return { selected: [], available, error: message, usage, ...(ran === undefined ? {} : { ran }) }
  }
}

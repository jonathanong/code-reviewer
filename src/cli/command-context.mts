import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { splitRepo } from '../gh-cli/index.mts'
import { resolveRulePlugins } from '../review/grant-settings.mts'
import { buildContext } from '../review/context/build.mts'
import { renderContext } from '../review/context/render.mts'
import type { ContextDeps, ContextSkill } from '../review/context/types.mts'
import { listRuleSkillFiles } from '../review/run/select-skills.mts'
import type { ReviewDeps } from './deps.mts'

export type ContextValues = {
  repo?: string[] | undefined
  pr?: string | undefined
  tree?: string | undefined
  out?: string | undefined
  skill?: string[] | undefined
}

type Needs = Pick<ReviewDeps, 'configs' | 'targetConfig' | 'pluginInfo' | 'runner' | 'exec'>

function chosen(all: ContextSkill[], names: readonly string[]): ContextSkill[] {
  const missing = names.filter((name) => !all.some((skill) => skill.name === name))
  if (missing.length > 0)
    throw new Error(`--skill not found among the rule skills: ${missing.join(', ')}`)
  return names.length === 0 ? all : all.filter((skill) => names.includes(skill.name))
}

/**
 * `code-reviewer context`: builds the shared review context for a pull request and prints it, or
 * writes `context.md` to `--out`. The head is the checkout's; the base is the one thing git
 * cannot know. No model runs and no review reads the result yet.
 */
export async function contextCommand(
  values: ContextValues,
  deps: Needs,
  write: (text: string) => void = (text) => void process.stdout.write(text),
): Promise<number> {
  const repo = values.repo?.[0]
  if (repo === undefined || values.pr === undefined || values.tree === undefined) {
    throw new Error('context needs --repo, --pr and --tree.')
  }
  const pr = Number(values.pr)
  const tree = resolve(values.tree)
  const head = (await deps.exec('git', ['-C', tree, 'rev-parse', 'HEAD'])).trim()
  const view = await deps.runner(splitRepo(repo).owner)([
    'pr',
    'view',
    String(pr),
    '-R',
    repo,
    '--json',
    'baseRefOid',
  ])
  const { baseRefOid } = JSON.parse(view) as { baseRefOid: string }
  const own = (await deps.targetConfig(repo)).config
  const plugins = resolveRulePlugins(deps.configs(), repo, own).names
  const { installs } = await deps.pluginInfo()
  const unreadable: string[] = []
  const skills = chosen(listRuleSkillFiles(installs, plugins, unreadable), values.skill ?? [])
  const out = resolve(values.out ?? '.')
  const contextDeps: ContextDeps = {
    exec: deps.exec,
    readFile: async (path) => readFileSync(path, 'utf8'),
  }
  const built = await buildContext(
    { repo, pr, tree, baseSha: baseRefOid, headSha: head, out, skills },
    contextDeps,
  )
  const text = renderContext({ ...built, notes: [...unreadable, ...built.notes] })
  if (values.out === undefined) write(text)
  else {
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'context.md'), text)
  }
  return 0
}

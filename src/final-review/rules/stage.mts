import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { instructionPaths, referencePaths, skillPaths } from './collect.mts'
import { NO_CONFIGS, type RepoConfigs } from './config.mts'
import { declaredLinks } from './declared.mts'
import { renderIndex, type Staged } from './index-render.mts'
import type { RuleReader } from './reader.mts'
import { findRelated, MAX_RELATED, type Related } from './related.mts'
import { sharedPaths, type SharedSource } from './shared.mts'
import { classify, copy, listAll, type Files } from './stage-files.mts'
import { suggestSkills } from './topics.mts'

export type StageInput = {
  changedPaths: readonly string[]
  diff: string
  repo?: { reader: RuleReader; refLabel: string }
  /** The reviewed repository's `owner/name`, when known. */
  repoId?: string
  /** The reviewer's per-repository configs; none when omitted. */
  configs?: RepoConfigs
  shared: { source: SharedSource; reader: RuleReader; refLabel: string }[]
  /**
   * Candidate repositories; only those the diff uses or the configs link to this change are
   * staged. `repo` is `owner/name` when the origin is known.
   */
  related: {
    name: string
    repo?: string
    reader: RuleReader
    refLabel: string
    codeHint: string
    stageCode: boolean
  }[]
  missing: string[]
}

export type StageResult = {
  /** Files written, relative to `out`. */
  written: string[]
  digest: string
  suggested: string[]
  related: string[]
  /** Repositories configured as consuming what this change touches. */
  consumers: string[]
  missing: string[]
}

type Dep = { name: string; heading: string; label: string; code: string; staged: Staged }
type Item = StageInput['related'][number]

function heading(hit: Related): string {
  const packages = hit.packages.map((name) => `\`${name}\``).join(', ')
  const used = packages === '' ? 'used' : `package ${packages} used`
  return `${hit.name}: ${used} in ${hit.where}`
}

/** Stages one linked repository's instructions and skills under `rules/<kind>/<name>/`. */
async function stageLinked(
  files: Files,
  item: Item,
  kind: 'deps' | 'consumers',
  title: string,
  missing: string[],
): Promise<Dep> {
  const all = await listAll(item.reader, item.name, missing)
  const dest = `${kind}/${item.name}`
  const skills = skillPaths(all)
  const own = [...instructionPaths(all, []), ...skills, ...referencePaths(all, skills)]
  const staged = classify(await copy(files, item.reader, dest, own))
  // Benchmark fixtures carry the repository's code beside its rules.
  if (item.stageCode) await copy(files, item.reader, dest, all)
  const code = item.stageCode ? `${dest}/` : item.codeHint
  return { name: item.name, heading: title, label: item.refLabel, code, staged }
}

/** Configured dependencies first, then those the diff imports, then configured consumers. */
async function stageLinks(
  files: Files,
  input: StageInput,
  missing: string[],
): Promise<{ deps: Dep[]; consumers: Dep[] }> {
  const links = declaredLinks({
    ...(input.repoId === undefined ? {} : { repoId: input.repoId }),
    configs: input.configs ?? NO_CONFIGS,
    candidates: input.related,
    changedPaths: input.changedPaths,
    diff: input.diff,
  })
  missing.push(...links.missing)
  const find = (name: string) => input.related.find((item) => item.name === name) as Item
  const deps: Dep[] = []
  for (const link of links.deps) {
    deps.push(await stageLinked(files, find(link.name), 'deps', link.heading, missing))
  }
  const rest = input.related.filter((item) => !deps.some((dep) => dep.name === item.name))
  const room = Math.max(0, MAX_RELATED - deps.length)
  for (const hit of await findRelated(rest, input.diff, '', room)) {
    deps.push(await stageLinked(files, find(hit.name), 'deps', heading(hit), missing))
  }
  const consumers: Dep[] = []
  for (const link of links.consumers) {
    consumers.push(await stageLinked(files, find(link.name), 'consumers', link.heading, missing))
  }
  return { deps, consumers }
}

/**
 * Copies the rule sources for a change into `<out>/rules/` and writes `INDEX.md`: this repository's
 * instructions and skills, the shared skills, and the rules of the repositories it depends on or
 * that consume it.
 */
export async function stageRuleSources(out: string, input: StageInput): Promise<StageResult> {
  const files: Files = new Map()
  const missing = [...input.missing]
  if (input.repo === undefined) missing.unshift('This repository: not staged (no --tree)')
  let repo: { label: string; staged: Staged } | undefined
  if (input.repo !== undefined) {
    const all = await listAll(input.repo.reader, 'This repository', missing)
    const skills = skillPaths(all)
    const paths = [
      ...instructionPaths(all, input.changedPaths),
      ...skills,
      ...referencePaths(all, skills),
    ]
    repo = {
      label: input.repo.refLabel,
      staged: classify(await copy(files, input.repo.reader, 'repo', paths)),
    }
  }
  const suggested = suggestSkills(input.changedPaths)
  const shared = []
  for (const item of input.shared) {
    const all = await listAll(item.reader, item.source.name, missing)
    const paths = sharedPaths(item.source, all)
    const dest = `shared/${item.source.name}`
    const staged = await copy(files, item.reader, dest, paths, item.source.prefix)
    shared.push({ name: item.source.name, label: item.refLabel, staged: classify(staged) })
  }
  const { deps, consumers } = await stageLinks(files, input, missing)
  const index = renderIndex({
    ...(repo === undefined ? {} : { repo }),
    shared,
    deps,
    consumers,
    suggested,
    missing,
  })
  files.set('rules/INDEX.md', index)
  const written = [...files.keys()].sort()
  const hash = createHash('sha256')
  for (const path of written) hash.update(`${path}\0${files.get(path)}\0`)
  for (const [path, text] of files) {
    mkdirSync(dirname(join(out, path)), { recursive: true })
    writeFileSync(join(out, path), text)
  }
  const staged = new Set(
    shared.flatMap((source) => source.staged.skills.map((skill) => skill.name)),
  )
  return {
    written,
    digest: hash.digest('hex'),
    suggested: [...suggested.keys()].filter((name) => staged.has(name)),
    related: deps.map((dep) => dep.name),
    consumers: consumers.map((dep) => dep.name),
    missing,
  }
}

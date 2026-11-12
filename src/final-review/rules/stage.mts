import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { instructionPaths, skillInfo, skillPaths } from './collect.mts'
import { renderIndex, type Staged } from './index-render.mts'
import type { RuleReader } from './reader.mts'
import { findRelated, type Related } from './related.mts'
import { sharedPaths, type SharedSource } from './shared.mts'
import { suggestSkills } from './topics.mts'

export type StageInput = {
  changedPaths: readonly string[]
  diff: string
  repo?: { reader: RuleReader; refLabel: string }
  shared: { source: SharedSource; reader: RuleReader; refLabel: string }[]
  /** Candidate dependency repositories; only those the diff uses are staged. */
  related: {
    name: string
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
  missing: string[]
}

type Files = Map<string, string>

/** Copies `paths` into `rules/<dest>/`, dropping `strip` from each; returns what was staged. */
async function copy(
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

function classify(staged: Map<string, string>): Staged {
  const paths = [...staged.keys()]
  const isSkill = (path: string) => path.endsWith('/SKILL.md')
  const isInstruction = (path: string) => /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/u.test(path)
  return {
    instructions: paths.filter((path) => isInstruction(path)),
    skills: paths.filter(isSkill).map((path) => skillInfo(path, staged.get(path) as string)),
    references: paths.filter((path) => !isSkill(path) && !isInstruction(path)),
  }
}

async function listAll(reader: RuleReader, name: string, missing: string[]): Promise<string[]> {
  try {
    return await reader.list()
  } catch {
    missing.push(`${name}: could not list files at ${reader.label}`)
    return []
  }
}

type Dep = { name: string; heading: string; label: string; code: string; staged: Staged }

function heading(hit: Related): string {
  const packages = hit.packages.map((name) => `\`${name}\``).join(', ')
  const used = packages === '' ? 'used' : `package ${packages} used`
  return `${hit.name}: ${used} in ${hit.where}`
}

async function stageDeps(files: Files, input: StageInput, missing: string[]): Promise<Dep[]> {
  const candidates = input.related.map(({ name, reader, codeHint }) => ({ name, reader, codeHint }))
  const deps: Dep[] = []
  for (const hit of await findRelated(candidates, input.diff)) {
    const item = input.related.find(
      (candidate) => candidate.name === hit.name,
    ) as StageInput['related'][number]
    const all = await listAll(item.reader, hit.name, missing)
    const dest = `deps/${hit.name}`
    const own = [...instructionPaths(all, []), ...skillPaths(all)]
    const staged = classify(await copy(files, item.reader, dest, own))
    // Benchmark fixtures carry the dependency's code beside its rules.
    if (item.stageCode) await copy(files, item.reader, dest, all)
    const code = item.stageCode ? `${dest}/` : item.codeHint
    deps.push({ name: hit.name, heading: heading(hit), label: item.refLabel, code, staged })
  }
  return deps
}

/**
 * Copies the rule sources for a change into `<out>/rules/` and writes `INDEX.md`: this repository's
 * instructions and skills, the shared skills, and the rules of dependency repositories in use.
 */
export async function stageRuleSources(out: string, input: StageInput): Promise<StageResult> {
  const files: Files = new Map()
  const missing = [...input.missing]
  if (input.repo === undefined) missing.unshift('This repository: not staged (no --tree)')
  let repo: { label: string; staged: Staged } | undefined
  if (input.repo !== undefined) {
    const all = await listAll(input.repo.reader, 'This repository', missing)
    const paths = [...instructionPaths(all, input.changedPaths), ...skillPaths(all)]
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
  const deps = await stageDeps(files, input, missing)
  const index = renderIndex({
    ...(repo === undefined ? {} : { repo }),
    shared,
    deps,
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
    missing,
  }
}

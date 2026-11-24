import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { pluginRoot } from '../plugin-root.mts'
import { normalizeSpace } from './answers.mts'
import { ReviewError } from './finding.mts'
import { charLength, MAX_FOCUS_CHARS } from './focus.mts'
import { parseYamlConfig } from './rules/yaml-config.mts'

/** Valid target name: lowercase kebab-case. */
export const TARGET_NAME = /^[a-z][a-z0-9-]*$/u

/** A built-in targeted check loaded from `skills/review/references/targets/<name>.md`. */
export type ReviewTarget = {
  name: string
  /** One sentence naming the kind of change this target applies to; shown to selection. */
  when: string
  /** Verbatim focus point text from the file body; shown only to the focus step. */
  point: string
}

/** What the selection step sees of each target; it never sees target bodies. */
export type TargetOffer = Pick<ReviewTarget, 'name' | 'when'>

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u

/** Parses one target Markdown file; the body is kept verbatim (trimmed) up to the focus cap. */
export function parseTargetFile(text: string, file: string): ReviewTarget {
  const match = FRONTMATTER_RE.exec(text)
  if (match === null) throw new ReviewError(`${file}: target file must begin with YAML frontmatter`)
  let meta: unknown
  try {
    meta = parseYamlConfig(match[1] as string)
  } catch (error) {
    throw new ReviewError(`${file}: invalid frontmatter: ${(error as Error).message}`, {
      cause: error,
    })
  }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new ReviewError(`${file}: target frontmatter must be a mapping`)
  }
  const record = meta as Record<string, unknown>
  const extra = Object.keys(record).filter((key) => key !== 'name' && key !== 'when')
  if (extra.length > 0) {
    throw new ReviewError(`${file}: unknown frontmatter key ${extra.join(', ')}`)
  }
  if (typeof record.name !== 'string' || !TARGET_NAME.test(record.name)) {
    throw new ReviewError(`${file}: name must match [a-z][a-z0-9-]*`)
  }
  if (typeof record.when !== 'string' || record.when.trim() === '') {
    throw new ReviewError(`${file}: when must be a non-empty string`)
  }
  const point = (match[2] as string).trim()
  if (point === '') throw new ReviewError(`${file}: target body must not be empty`)
  if (/\r?\n\s*\r?\n/u.test(point)) {
    throw new ReviewError(`${file}: target body must be one paragraph`)
  }
  const length = charLength(point)
  if (length > MAX_FOCUS_CHARS) {
    throw new ReviewError(`${file}: target body is ${length} characters; max is ${MAX_FOCUS_CHARS}`)
  }
  return { name: record.name, when: normalizeSpace(record.when), point }
}

/** Loads every `*.md` target under `<referencesDir>/targets/`; empty when the directory is absent. */
export function loadTargets(referencesDir: string): ReviewTarget[] {
  const dir = join(referencesDir, 'targets')
  if (!existsSync(dir)) return []
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
  const seen = new Set<string>()
  const targets: ReviewTarget[] = []
  for (const name of files) {
    const file = join(dir, name)
    const target = parseTargetFile(readFileSync(file, 'utf8'), file)
    if (seen.has(target.name)) {
      throw new ReviewError(`${file}: duplicate target name "${target.name}"`)
    }
    seen.add(target.name)
    targets.push(target)
  }
  return targets.sort((a, b) => a.name.localeCompare(b.name))
}

/** Default directory holding built-in prompts and `targets/`. */
export const defaultReferencesDir = (): string => join(pluginRoot(), 'skills/review/references')

/** Names of every target in `<referencesDir>/targets/`, sorted. */
export const targetNamesIn = (referencesDir: string): string[] =>
  loadTargets(referencesDir).map((target) => target.name)

/** Built-in targets from the installed plugin's `skills/review/references/targets/`. */
export function builtInTargets(referencesDir = defaultReferencesDir()): ReviewTarget[] {
  return loadTargets(referencesDir)
}

/** Names of the built-in targets, sorted. */
export const builtInTargetNames = (referencesDir = defaultReferencesDir()): string[] =>
  targetNamesIn(referencesDir)

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { StackFile } from './stack-file.mts'

export const DEPENDENCIES_FILE = 'dependencies.json'

export const DEPENDENCY_STATES = ['open', 'merged', 'closed', 'unknown'] as const
export type DependencyState = (typeof DEPENDENCY_STATES)[number]

/** Named by a person or by the stack, or implied by the change and found by the verifier. */
export const IMPLIED_KINDS = [
  'package',
  'service',
  'api',
  'schema',
  'flag',
  'infra',
  'other',
] as const
export const DEPENDENCY_KINDS = ['pull', 'issue', 'stack-parent', ...IMPLIED_KINDS] as const
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number]

/** Something outside this change that has to be true or landed first. Informational only. */
export type Dependency = {
  on: string
  kind: DependencyKind
  state: DependencyState
  why: string
}

const MAX_DEPENDENCIES = 15
const MAX_ON = 120
const MAX_WHY = 300

/** Model or author text on one line, without backticks, and without notifying anyone. */
export const oneLine = (text: string, max: number) =>
  text.replace(/`/gu, '').replace(/\s+/gu, ' ').replace(/@/gu, '@​').trim().slice(0, max)

export function clearDependencies(out: string): void {
  rmSync(join(out, DEPENDENCIES_FILE), { force: true })
}

export function readDependencies(out: string): Dependency[] | undefined {
  const path = join(out, DEPENDENCIES_FILE)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Dependency[]) : undefined
}

/** The pull requests this one is stacked on; each is open, since the stack lists open pull requests. */
export function stackDependencies(stack: StackFile): Dependency[] {
  return stack.members.slice(0, stack.index).map((member) => ({
    on: `#${member.number}`,
    kind: 'stack-parent',
    state: 'open',
    why: 'This pull request is stacked on it.',
  }))
}

/**
 * The verifier's implied dependencies: its words are bounded and its claimed state is ignored,
 * since only a lookup can know a state. Anything malformed is dropped, not fatal.
 */
export function impliedDependencies(raw: unknown): Dependency[] {
  if (!Array.isArray(raw)) return []
  return (raw as unknown[]).flatMap((entry) => {
    const { on, kind, why } = (entry ?? {}) as { on?: unknown; kind?: unknown; why?: unknown }
    const name = typeof on === 'string' ? oneLine(on, MAX_ON) : ''
    const reason = typeof why === 'string' ? oneLine(why, MAX_WHY) : ''
    const known = IMPLIED_KINDS.find((candidate) => candidate === kind)
    return name === '' || reason === '' || known === undefined
      ? []
      : [{ on: name, kind: known, state: 'unknown' as const, why: reason }]
  })
}

/** Explicit first, then implied, once per `on`, capped. */
export function mergeDependencies(
  explicit: readonly Dependency[],
  implied: readonly Dependency[],
): Dependency[] {
  const seen = new Set<string>()
  return [...explicit, ...implied]
    .filter((dependency) => {
      const key = dependency.on.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_DEPENDENCIES)
}
